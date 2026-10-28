using System;
using System.Diagnostics;
using System.Drawing;
using System.Drawing.Drawing2D;
using System.Drawing.Text;
using System.IO;
using System.Security.Principal;
using System.Text;
using System.Threading;
using System.Windows.Forms;

namespace StreetoControl
{
    internal static class Program
    {
        [STAThread]
        private static void Main()
        {
            if (!IsAdministrator())
            {
                try
                {
                    ProcessStartInfo info = new ProcessStartInfo();
                    info.FileName = Application.ExecutablePath;
                    info.UseShellExecute = true;
                    info.Verb = "runas";
                    Process.Start(info);
                }
                catch
                {
                    /* the user cancelled UAC */
                }
                return;
            }

            string root = AppDomain.CurrentDomain.BaseDirectory.TrimEnd('\\');
            string node = FindNode();
            if (node == null)
            {
                MessageBox.Show("Node.js was not found. Install Node.js 22.5 or newer.",
                    "STREETO Control", MessageBoxButtons.OK, MessageBoxIcon.Warning);
                return;
            }
            if (!File.Exists(Path.Combine(root, "scripts", "service-control.mjs")))
            {
                MessageBox.Show("STREETO-Control.exe must stay in the STREETO project folder.",
                    "STREETO Control", MessageBoxButtons.OK, MessageBoxIcon.Warning);
                return;
            }

            Application.EnableVisualStyles();
            Application.SetCompatibleTextRenderingDefault(false);
            Application.Run(new MainForm(root, node));
        }

        private static bool IsAdministrator()
        {
            try
            {
                WindowsIdentity identity = WindowsIdentity.GetCurrent();
                WindowsPrincipal principal = new WindowsPrincipal(identity);
                return principal.IsInRole(WindowsBuiltInRole.Administrator);
            }
            catch
            {
                return false;
            }
        }

        private static string FindNode()
        {
            string programFiles = Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles);
            string programFilesX86 = Environment.GetFolderPath(Environment.SpecialFolder.ProgramFilesX86);
            string[] candidates = new string[]
            {
                Path.Combine(programFiles, "nodejs", "node.exe"),
                Path.Combine(programFilesX86, "nodejs", "node.exe"),
                Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "Programs", "nodejs", "node.exe")
            };
            foreach (string candidate in candidates)
            {
                if (File.Exists(candidate)) return candidate;
            }

            string path = Environment.GetEnvironmentVariable("PATH") ?? "";
            foreach (string folder in path.Split(';'))
            {
                try
                {
                    string candidate = Path.Combine(folder.Trim(), "node.exe");
                    if (File.Exists(candidate)) return candidate;
                }
                catch { }
            }
            return null;
        }
    }

    internal sealed class MainForm : Form
    {
        private readonly string root;
        private readonly string node;
        private readonly string controlScript;
        private readonly string logPath;

        private readonly Color ink = Color.FromArgb(8, 10, 15);
        private readonly Color panel = Color.FromArgb(17, 21, 29);
        private readonly Color hover = Color.FromArgb(29, 37, 50);
        private readonly Color line = Color.FromArgb(42, 49, 63);
        private readonly Color textColor = Color.FromArgb(242, 246, 250);
        private readonly Color muted = Color.FromArgb(145, 156, 174);
        private readonly Color neon = Color.FromArgb(31, 224, 255);
        private readonly Color green = Color.FromArgb(61, 220, 151);
        private readonly Color red = Color.FromArgb(255, 91, 108);
        private readonly Color amber = Color.FromArgb(255, 190, 72);

        private Font uiFont;
        private Font smallFont;
        private Font titleFont;
        private Font monoFont;
        private PrivateFontCollection fonts;

        private StatusDot serverDot;
        private StatusDot tunnelDot;
        private StatusDot localDot;
        private StatusDot publicDot;
        private Label serverText;
        private Label tunnelText;
        private Label localText;
        private Label publicText;
        private FlatButton installButton;
        private TextBox logBox;
        private System.Windows.Forms.Timer timer;
        private string publicUrl = "https://streeto.net";
        private bool busy;

        public MainForm(string root, string node)
        {
            this.root = root;
            this.node = node;
            this.controlScript = Path.Combine(root, "scripts", "service-control.mjs");
            this.logPath = Path.Combine(root, "data", "logs", "server.log");

            Text = "STREETO Control";
            ClientSize = new Size(760, 560);
            StartPosition = FormStartPosition.CenterScreen;
            FormBorderStyle = FormBorderStyle.FixedSingle;
            MaximizeBox = false;
            BackColor = ink;
            ForeColor = textColor;
            AutoScaleMode = AutoScaleMode.Font;
            DoubleBuffered = true;
            LoadFonts();
            Font = uiFont;
            LoadIcon();
            BuildLayout();

            timer = new System.Windows.Forms.Timer();
            timer.Interval = 15000;
            timer.Tick += delegate { if (!busy) RefreshStatus(); };
            Shown += delegate
            {
                AppendLog("Ready. Checking the services...");
                RefreshStatus();
                timer.Start();
            };
            FormClosed += delegate
            {
                timer.Stop();
                timer.Dispose();
                if (fonts != null) fonts.Dispose();
            };
        }

        private void LoadFonts()
        {
            string fontPath = Path.Combine(root, "public", "fonts", "NotoSans-Regular.ttf");
            if (File.Exists(fontPath))
            {
                try
                {
                    fonts = new PrivateFontCollection();
                    fonts.AddFontFile(fontPath);
                    FontFamily family = fonts.Families[0];
                    uiFont = new Font(family, 9.5f, FontStyle.Regular);
                    smallFont = new Font(family, 8.5f, FontStyle.Regular);
                    titleFont = PickTitleFont(family);
                    monoFont = new Font("Consolas", 8.5f, FontStyle.Regular);
                    return;
                }
                catch
                {
                    /* fall back to the Windows fonts */
                }
            }
            uiFont = new Font("Segoe UI", 9.5f);
            smallFont = new Font("Segoe UI", 8.5f);
            titleFont = PickTitleFont(new FontFamily("Segoe UI"));
            monoFont = new Font("Consolas", 8.5f);
        }

        private Font PickTitleFont(FontFamily fallback)
        {
            try
            {
                Font title = new Font("Bahnschrift", 28f, FontStyle.Bold);
                if (String.Equals(title.Name, "Bahnschrift", StringComparison.OrdinalIgnoreCase))
                    return title;
                title.Dispose();
            }
            catch { }
            return new Font(fallback, 27f, FontStyle.Bold);
        }

        private void LoadIcon()
        {
            try
            {
                string iconPath = Path.Combine(root, "public", "icons", "icon-192.png");
                if (!File.Exists(iconPath)) return;
                using (Bitmap bitmap = new Bitmap(iconPath))
                {
                    Icon = Icon.FromHandle(bitmap.GetHicon());
                }
            }
            catch { }
        }

        private void BuildLayout()
        {
            Label title = new Label();
            title.Text = "STREETO";
            title.Font = titleFont;
            title.ForeColor = neon;
            title.AutoSize = true;
            title.Location = new Point(28, 16);
            Controls.Add(title);

            Label subtitle = new Label();
            subtitle.Text = "SERVER  /  CLOUDFLARE TUNNEL";
            subtitle.Font = smallFont;
            subtitle.ForeColor = muted;
            subtitle.AutoSize = true;
            subtitle.Location = new Point(31, 59);
            Controls.Add(subtitle);

            AddRow("Web server", 100, out serverDot, out serverText);
            AddRow("Cloudflare Tunnel", 132, out tunnelDot, out tunnelText);
            AddRow("Local HTTPS (443)", 164, out localDot, out localText);
            AddRow("Public site", 196, out publicDot, out publicText);

            Panel rule = new Panel();
            rule.BackColor = line;
            rule.Location = new Point(28, 232);
            rule.Size = new Size(704, 1);
            Controls.Add(rule);

            installButton = NewButton("Install services", "install", 28, 248, 138, true);
            NewButton("Start", "start", 178, 248, 76, false);
            NewButton("Stop", "stop", 262, 248, 76, false);
            NewButton("Restart", "restart", 346, 248, 88, false);
            NewButton("Open site", "open", 452, 248, 86, false);
            NewButton("Logs", "logs", 546, 248, 76, false);
            NewButton("Refresh", "refresh", 630, 248, 102, false);

            Label activity = new Label();
            activity.Text = "ACTIVITY";
            activity.Font = smallFont;
            activity.ForeColor = muted;
            activity.AutoSize = true;
            activity.Location = new Point(28, 300);
            Controls.Add(activity);

            logBox = new TextBox();
            logBox.Multiline = true;
            logBox.ReadOnly = true;
            logBox.ScrollBars = ScrollBars.Vertical;
            logBox.BackColor = Color.FromArgb(4, 6, 10);
            logBox.ForeColor = Color.FromArgb(190, 205, 220);
            logBox.BorderStyle = BorderStyle.FixedSingle;
            logBox.Font = monoFont;
            logBox.Location = new Point(28, 322);
            logBox.Size = new Size(704, 190);
            Controls.Add(logBox);

            Label footer = new Label();
            footer.Text = "Services keep running when this window is closed.";
            footer.Font = smallFont;
            footer.ForeColor = muted;
            footer.AutoSize = true;
            footer.Location = new Point(28, 526);
            Controls.Add(footer);
        }

        private void AddRow(string caption, int y, out StatusDot dot, out Label value)
        {
            dot = new StatusDot();
            dot.Location = new Point(30, y + 6);
            dot.DotColor = muted;
            Controls.Add(dot);

            Label label = new Label();
            label.Text = caption;
            label.Font = smallFont;
            label.ForeColor = muted;
            label.AutoSize = true;
            label.Location = new Point(50, y);
            Controls.Add(label);

            value = new Label();
            value.Text = "Checking...";
            value.Font = uiFont;
            value.ForeColor = textColor;
            value.AutoSize = true;
            value.Location = new Point(190, y);
            Controls.Add(value);
        }

        private FlatButton NewButton(string caption, string action, int x, int y, int width, bool primary)
        {
            FlatButton button = new FlatButton();
            button.Text = caption;
            button.Tag = action;
            button.Location = new Point(x, y);
            button.Size = new Size(width, 34);
            button.Font = uiFont;
            button.Cursor = Cursors.Hand;
            if (primary)
            {
                button.NormalColor = neon;
                button.HoverColor = Color.FromArgb(118, 240, 255);
                button.BorderColor = neon;
                button.TextColor = Color.FromArgb(4, 18, 26);
            }
            else
            {
                button.NormalColor = panel;
                button.HoverColor = hover;
                button.BorderColor = line;
                button.TextColor = textColor;
            }
            button.Click += delegate { RunAction((string)button.Tag); };
            Controls.Add(button);
            return button;
        }

        private void AppendLog(string message)
        {
            if (String.IsNullOrEmpty(message)) return;
            if (logBox.TextLength > 80000) logBox.Clear();
            logBox.AppendText("[" + DateTime.Now.ToString("HH:mm:ss") + "] " + message + "\r\n");
            logBox.SelectionStart = logBox.TextLength;
            logBox.ScrollToCaret();
        }

        private string RunControl(string command, out int exitCode)
        {
            ProcessStartInfo info = new ProcessStartInfo();
            info.FileName = node;
            info.Arguments = "\"" + controlScript + "\" " + command;
            info.WorkingDirectory = root;
            info.UseShellExecute = false;
            info.CreateNoWindow = true;
            info.RedirectStandardOutput = true;
            info.RedirectStandardError = true;
            info.StandardOutputEncoding = Encoding.UTF8;
            info.StandardErrorEncoding = Encoding.UTF8;

            using (Process process = Process.Start(info))
            {
                System.Threading.Tasks.Task<string> stdout = process.StandardOutput.ReadToEndAsync();
                System.Threading.Tasks.Task<string> stderr = process.StandardError.ReadToEndAsync();
                while (!process.HasExited)
                {
                    Application.DoEvents();
                    Thread.Sleep(50);
                }
                exitCode = process.ExitCode;
                string output = (stdout.Result + Environment.NewLine + stderr.Result).Trim();
                return output;
            }
        }

        private void RefreshStatus()
        {
            if (busy) return;
            try
            {
                int code;
                string output = RunControl("status --plain", out code);
                if (code != 0 || output.Length == 0)
                {
                    SetPlainRow(serverDot, serverText, "Status unavailable", red);
                    SetPlainRow(tunnelDot, tunnelText, "Status unavailable", red);
                    SetPlainRow(localDot, localText, "", muted);
                    SetPlainRow(publicDot, publicText, "", muted);
                    return;
                }

                string appInstalled = Field(output, "APP_INSTALLED");
                string appState = Field(output, "APP_STATE");
                string tunnelInstalled = Field(output, "TUNNEL_INSTALLED");
                string tunnelState = Field(output, "TUNNEL_STATE");
                string localState = Field(output, "LOCAL");
                string publicState = Field(output, "PUBLIC");
                string url = Field(output, "PUBLIC_URL");
                if (!String.IsNullOrEmpty(url)) publicUrl = url;

                SetServiceRow(serverDot, serverText, appState, appInstalled == "true");
                SetServiceRow(tunnelDot, tunnelText, tunnelState, tunnelInstalled == "true");
                SetPlainRow(localDot, localText, localState + (localState == "ok" ? "  \u00B7  port 443 listening" : "  \u00B7  not answering"), localState == "ok" ? green : red);
                SetPlainRow(publicDot, publicText, publicState + "  \u00B7  " + publicUrl, publicState == "ok" ? green : red);

                installButton.Text = (appInstalled == "true" && tunnelInstalled == "true")
                    ? "Repair services" : "Install services";
            }
            catch (Exception error)
            {
                SetPlainRow(serverDot, serverText, "Status unavailable", red);
                SetPlainRow(tunnelDot, tunnelText, "", muted);
                SetPlainRow(localDot, localText, "", muted);
                SetPlainRow(publicDot, publicText, "", muted);
                AppendLog("Status failed: " + error.Message);
            }
        }

        private string Field(string output, string name)
        {
            foreach (string raw in output.Split('\n'))
            {
                string row = raw.Trim();
                int eq = row.IndexOf('=');
                if (eq <= 0) continue;
                if (row.Substring(0, eq) == name) return row.Substring(eq + 1);
            }
            return "";
        }

        private void SetServiceRow(StatusDot dot, Label label, string state, bool installed)
        {
            string value = state + (installed ? "  \u00B7  installed" : "  \u00B7  not installed");
            Color color = installed && (state == "running" || state == "ready") ? green
                : (state == "stopped" || state == "disabled" || !installed) ? red : amber;
            SetPlainRow(dot, label, value, color);
        }

        private void SetPlainRow(StatusDot dot, Label label, string value, Color color)
        {
            dot.DotColor = color;
            dot.Invalidate();
            label.Text = value;
            label.ForeColor = color;
        }

        private void SetBusy(bool value)
        {
            busy = value;
            foreach (Control control in Controls)
            {
                FlatButton button = control as FlatButton;
                if (button != null) button.Enabled = !value;
            }
            Application.DoEvents();
        }

        private void RunAction(string action)
        {
            if (busy) return;
            if (action == "open")
            {
                try { Process.Start(new ProcessStartInfo(publicUrl) { UseShellExecute = true }); }
                catch (Exception error) { AppendLog(error.Message); }
                return;
            }
            if (action == "logs")
            {
                if (File.Exists(logPath)) Process.Start("notepad.exe", "\"" + logPath + "\"");
                else AppendLog("No service log yet. Install or start the services first.");
                return;
            }
            if (action == "refresh")
            {
                RefreshStatus();
                return;
            }

            SetBusy(true);
            try
            {
                AppendLog("> " + action);
                int code;
                string output = RunControl(action, out code);
                if (!String.IsNullOrEmpty(output)) AppendLog(output);
                if (code != 0) AppendLog("The controller returned exit code " + code + ".");
                RefreshStatus();
            }
            catch (Exception error)
            {
                AppendLog("Failed: " + error.Message);
                MessageBox.Show(error.Message, "STREETO Control", MessageBoxButtons.OK, MessageBoxIcon.Warning);
            }
            finally
            {
                SetBusy(false);
            }
        }
    }

    internal sealed class StatusDot : Control
    {
        private Color dotColor = Color.Gray;

        public Color DotColor
        {
            get { return dotColor; }
            set { dotColor = value; Invalidate(); }
        }

        public StatusDot()
        {
            SetStyle(ControlStyles.AllPaintingInWmPaint | ControlStyles.UserPaint | ControlStyles.OptimizedDoubleBuffer, true);
            Size = new Size(11, 11);
        }

        protected override void OnPaint(PaintEventArgs e)
        {
            base.OnPaint(e);
            e.Graphics.SmoothingMode = SmoothingMode.AntiAlias;
            using (SolidBrush brush = new SolidBrush(dotColor))
            {
                e.Graphics.FillEllipse(brush, 1, 1, Width - 2, Height - 2);
            }
        }
    }

    internal sealed class FlatButton : Button
    {
        public Color NormalColor = Color.FromArgb(17, 21, 29);
        public Color HoverColor = Color.FromArgb(29, 37, 50);
        public Color BorderColor = Color.FromArgb(42, 49, 63);
        public Color TextColor = Color.White;
        private bool isHovered;

        public FlatButton()
        {
            SetStyle(ControlStyles.AllPaintingInWmPaint | ControlStyles.UserPaint |
                ControlStyles.OptimizedDoubleBuffer | ControlStyles.ResizeRedraw, true);
            FlatStyle = FlatStyle.Flat;
            FlatAppearance.BorderSize = 0;
            UseVisualStyleBackColor = false;
        }

        protected override void OnMouseEnter(EventArgs e)
        {
            isHovered = true;
            Invalidate();
            base.OnMouseEnter(e);
        }

        protected override void OnMouseLeave(EventArgs e)
        {
            isHovered = false;
            Invalidate();
            base.OnMouseLeave(e);
        }

        protected override void OnEnabledChanged(EventArgs e)
        {
            Invalidate();
            base.OnEnabledChanged(e);
        }

        protected override void OnPaint(PaintEventArgs e)
        {
            e.Graphics.SmoothingMode = SmoothingMode.AntiAlias;
            Color fill = Enabled ? (isHovered ? HoverColor : NormalColor) : Color.FromArgb(35, 40, 50);
            Color border = Enabled ? BorderColor : Color.FromArgb(55, 62, 76);
            Color text = Enabled ? TextColor : Color.FromArgb(120, 130, 145);
            using (GraphicsPath path = Rounded(ClientRectangle, 8))
            using (SolidBrush brush = new SolidBrush(fill))
            using (Pen pen = new Pen(border, 1))
            {
                e.Graphics.FillPath(brush, path);
                e.Graphics.DrawPath(pen, path);
            }
            TextRenderer.DrawText(e.Graphics, Text, Font, ClientRectangle, text,
                TextFormatFlags.HorizontalCenter | TextFormatFlags.VerticalCenter | TextFormatFlags.NoPadding);
        }

        private static GraphicsPath Rounded(Rectangle rectangle, int radius)
        {
            GraphicsPath path = new GraphicsPath();
            int diameter = radius * 2;
            Rectangle arc = new Rectangle(rectangle.X, rectangle.Y, diameter, diameter);
            path.AddArc(arc, 180, 90);
            arc.X = rectangle.Right - diameter;
            path.AddArc(arc, 270, 90);
            arc.Y = rectangle.Bottom - diameter;
            path.AddArc(arc, 0, 90);
            arc.X = rectangle.Left;
            path.AddArc(arc, 90, 90);
            path.CloseFigure();
            return path;
        }
    }
}
