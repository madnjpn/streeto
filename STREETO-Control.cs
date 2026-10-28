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
            if (!IsAdministrator() && Environment.GetEnvironmentVariable("STREETO_CONTROL_ALLOW_NONADMIN") != "1")
            {
                try
                {
                    ProcessStartInfo info = new ProcessStartInfo();
                    info.FileName = Application.ExecutablePath;
                    info.UseShellExecute = true;
                    info.Verb = "runas";
                    Process.Start(info);
                }
                catch { }
                return;
            }

            string root = AppDomain.CurrentDomain.BaseDirectory.TrimEnd('\\');
            string node = FindNode(root);
            if (node == null)
            {
                MessageBox.Show("Node.js was not found. Install Node.js 22.5 or newer, or keep runtime\\node\\node.exe in the project.",
                    "STREETO Control", MessageBoxButtons.OK, MessageBoxIcon.Warning);
                return;
            }
            if (!File.Exists(Path.Combine(root, "scripts", "service-control.mjs")))
            {
                MessageBox.Show("STREETO Control.exe must stay in the STREETO project folder.",
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
            catch { return false; }
        }

        private static string FindNode(string root)
        {
            string portable = Path.Combine(root, "runtime", "node", "node.exe");
            if (File.Exists(portable)) return portable;

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

        private readonly Color ink = Color.FromArgb(7, 8, 11);
        private readonly Color ink2 = Color.FromArgb(11, 13, 18);
        private readonly Color panel = Color.FromArgb(17, 20, 26);
        private readonly Color panel2 = Color.FromArgb(21, 25, 34);
        private readonly Color line = Color.FromArgb(36, 42, 54);
        private readonly Color lineSoft = Color.FromArgb(26, 31, 40);
        private readonly Color textColor = Color.FromArgb(233, 237, 245);
        private readonly Color muted = Color.FromArgb(133, 143, 163);
        private readonly Color dim = Color.FromArgb(93, 102, 120);
        private readonly Color neon = Color.FromArgb(31, 224, 255);
        private readonly Color neonDeep = Color.FromArgb(10, 156, 196);
        private readonly Color neon2 = Color.FromArgb(255, 45, 120);
        private readonly Color neon3 = Color.FromArgb(182, 255, 60);
        private readonly Color amber = Color.FromArgb(255, 176, 32);
        private readonly Color danger = Color.FromArgb(255, 77, 94);
        private readonly Color dangerSoft = Color.FromArgb(255, 138, 150);
        private readonly Color ok = Color.FromArgb(120, 230, 130);
        private readonly Color onAccent = Color.FromArgb(4, 20, 26);
        private readonly Color accentA = Color.FromArgb(47, 233, 255);
        private readonly Color accentB = Color.FromArgb(15, 184, 221);
        private readonly Color accentC = Color.FromArgb(8, 147, 184);

        private Font uiFont;
        private Font smallFont;
        private Font smallBold;
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
            ClientSize = new Size(700, 560);
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
                    smallFont = new Font(family, 8.3f, FontStyle.Regular);
                    smallBold = new Font(family, 8.3f, FontStyle.Bold);
                    titleFont = PickTitleFont(family);
                    monoFont = new Font("Consolas", 8.5f, FontStyle.Regular);
                    return;
                }
                catch { }
            }
            uiFont = new Font("Segoe UI", 9.5f);
            smallFont = new Font("Segoe UI", 8.3f);
            smallBold = new Font("Segoe UI", 8.3f, FontStyle.Bold);
            titleFont = PickTitleFont(new FontFamily("Segoe UI"));
            monoFont = new Font("Consolas", 8.5f);
        }

        private Font PickTitleFont(FontFamily fallback)
        {
            try
            {
                Font title = new Font("Bahnschrift", 35f, FontStyle.Bold);
                if (String.Equals(title.Name, "Bahnschrift", StringComparison.OrdinalIgnoreCase)) return title;
                title.Dispose();
            }
            catch { }
            return new Font(fallback, 32f, FontStyle.Bold);
        }

        private void LoadIcon()
        {
            try
            {
                string iconPath = Path.Combine(root, "public", "icons", "streeto-mark.png");
                if (!File.Exists(iconPath)) iconPath = Path.Combine(root, "public", "icons", "icon-192.png");
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
            Label eyebrow = MakeLabel(this, "CONTROL ROOM", smallBold, neon, 34, 23);
            Label subtitle = MakeLabel(this, "SERVER  /  CLOUDFLARE TUNNEL", smallFont, muted, 35, 94);

            GlowTitle title = new GlowTitle();
            title.Text = "STREETO";
            title.Font = titleFont;
            title.ForeColor = neon;
            title.GlowColor = neon;
            title.Location = new Point(32, 38);
            title.Size = new Size(420, 58);
            Controls.Add(title);

            CardPanel statusCard = new CardPanel();
            statusCard.Location = new Point(24, 112);
            statusCard.Size = new Size(652, 196);
            statusCard.Radius = 16;
            statusCard.FillColor = panel;
            statusCard.BorderColor = line;
            Controls.Add(statusCard);

            MakeLabel(statusCard, "SYSTEM STATUS", smallBold, neon, 20, 14);
            StatusDot liveDot = new StatusDot();
            liveDot.DotColor = ok;
            liveDot.Location = new Point(578, 20);
            statusCard.Controls.Add(liveDot);
            MakeLabel(statusCard, "LIVE", smallBold, ok, 595, 14);

            AddRow(statusCard, "Web server", 50, out serverDot, out serverText);
            AddRule(statusCard, 80);
            AddRow(statusCard, "Cloudflare Tunnel", 92, out tunnelDot, out tunnelText);
            AddRule(statusCard, 122);
            AddRow(statusCard, "Local HTTPS", 134, out localDot, out localText);
            AddRule(statusCard, 164);
            AddRow(statusCard, "Public site", 176, out publicDot, out publicText);

            installButton = NewButton("Install", "install", 24, 326, 112, ButtonKind.Primary);
            NewButton("Start", "start", 146, 326, 58, ButtonKind.Ghost);
            NewButton("Stop", "stop", 212, 326, 58, ButtonKind.Danger);
            NewButton("Restart", "restart", 278, 326, 76, ButtonKind.Ghost);
            NewButton("Site", "open", 362, 326, 58, ButtonKind.Ghost);
            NewButton("Logs", "logs", 428, 326, 58, ButtonKind.Ghost);
            NewButton("Refresh", "refresh", 494, 326, 74, ButtonKind.Ghost);

            CardPanel activityCard = new CardPanel();
            activityCard.Location = new Point(24, 374);
            activityCard.Size = new Size(652, 160);
            activityCard.Radius = 16;
            activityCard.FillColor = panel;
            activityCard.BorderColor = line;
            Controls.Add(activityCard);

            MakeLabel(activityCard, "ACTIVITY", smallBold, neon, 20, 13);
            MakeLabel(activityCard, "LIVE LOG", smallFont, dim, 570, 13);

            logBox = new TextBox();
            logBox.Multiline = true;
            logBox.ReadOnly = true;
            logBox.ScrollBars = ScrollBars.Vertical;
            logBox.BackColor = Color.FromArgb(10, 12, 17);
            logBox.ForeColor = Color.FromArgb(170, 183, 202);
            logBox.BorderStyle = BorderStyle.None;
            logBox.Font = monoFont;
            logBox.Location = new Point(18, 38);
            logBox.Size = new Size(616, 104);
            activityCard.Controls.Add(logBox);

            MakeLabel(this, "SERVICES KEEP RUNNING WHEN THIS WINDOW IS CLOSED", smallFont, dim, 26, 542);
        }

        private Label MakeLabel(Control parent, string text, Font font, Color color, int x, int y)
        {
            Label label = new Label();
            label.Text = text;
            label.Font = font;
            label.ForeColor = color;
            label.BackColor = parent is CardPanel ? ((CardPanel)parent).FillColor : Color.Transparent;
            label.AutoSize = true;
            label.Location = new Point(x, y);
            parent.Controls.Add(label);
            return label;
        }

        private void AddRow(Control parent, string caption, int y, out StatusDot dot, out Label value)
        {
            dot = new StatusDot();
            dot.Location = new Point(22, y + 6);
            dot.DotColor = muted;
            parent.Controls.Add(dot);

            Label label = MakeLabel(parent, caption, smallFont, muted, 42, y);
            value = MakeLabel(parent, "Checking...", uiFont, textColor, 190, y);
        }

        private void AddRule(Control parent, int y)
        {
            Panel rule = new Panel();
            rule.BackColor = lineSoft;
            rule.Location = new Point(20, y);
            rule.Size = new Size(724, 1);
            parent.Controls.Add(rule);
        }

        private FlatButton NewButton(string caption, string action, int x, int y, int width, ButtonKind kind)
        {
            FlatButton button = new FlatButton();
            button.Text = caption.ToUpperInvariant();
            button.Tag = action;
            button.Location = new Point(x, y);
            button.Size = new Size(width, 34);
            button.Font = smallBold;
            button.Kind = kind;
            button.ApplyStyle();
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
                return (stdout.Result + Environment.NewLine + stderr.Result).Trim();
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
                    SetPlainRow(serverDot, serverText, "Status unavailable", danger);
                    SetPlainRow(tunnelDot, tunnelText, "Status unavailable", danger);
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
                SetPlainRow(localDot, localText,
                    localState == "ok" ? "OK  \u00B7  port 443 listening" : "Down  \u00B7  nothing on 443",
                    localState == "ok" ? ok : danger);
                SetPlainRow(publicDot, publicText,
                    (publicState == "ok" ? "OK" : "Down") + "  \u00B7  " + publicUrl,
                    publicState == "ok" ? ok : danger);

                installButton.Text = (appInstalled == "true" && tunnelInstalled == "true")
                    ? "REPAIR" : "INSTALL";
            }
            catch (Exception error)
            {
                SetPlainRow(serverDot, serverText, "Status unavailable", danger);
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
            string value = installed
                ? state.ToUpperInvariant() + "  \u00B7  INSTALLED"
                : "NOT INSTALLED";
            Color color = installed && (state == "running" || state == "ready") ? ok
                : (state == "stopped" || state == "disabled" || !installed) ? danger : amber;
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

        protected override void OnPaintBackground(PaintEventArgs e)
        {
            e.Graphics.SmoothingMode = SmoothingMode.AntiAlias;
            Rectangle bounds = ClientRectangle;
            using (LinearGradientBrush baseBrush = new LinearGradientBrush(
                bounds, ink, ink2, LinearGradientMode.Vertical))
            {
                e.Graphics.FillRectangle(baseBrush, bounds);
            }
            DrawGlow(e.Graphics, new Rectangle(520, -180, 560, 520), Color.FromArgb(42, neon));
            DrawGlow(e.Graphics, new Rectangle(-180, 400, 520, 420), Color.FromArgb(30, neon2));
            DrawGlow(e.Graphics, new Rectangle(280, -140, 420, 300), Color.FromArgb(14, neon3));
            using (Pen hairline = new Pen(Color.FromArgb(9, 255, 255, 255), 1))
            {
                for (int x = -ClientSize.Height; x < ClientSize.Width; x += 28)
                {
                    e.Graphics.DrawLine(hairline, x, 0, x + ClientSize.Height, ClientSize.Height);
                }
            }
        }

        private void DrawGlow(Graphics graphics, Rectangle rectangle, Color color)
        {
            using (GraphicsPath path = new GraphicsPath())
            {
                path.AddEllipse(rectangle);
                using (PathGradientBrush brush = new PathGradientBrush(path))
                {
                    brush.CenterColor = color;
                    brush.SurroundColors = new Color[] { Color.FromArgb(0, color) };
                    graphics.FillPath(brush, path);
                }
            }
        }
    }

    internal sealed class GlowTitle : Control
    {
        public Color GlowColor = Color.FromArgb(31, 224, 255);

        public GlowTitle()
        {
            SetStyle(ControlStyles.AllPaintingInWmPaint | ControlStyles.UserPaint |
                ControlStyles.OptimizedDoubleBuffer | ControlStyles.ResizeRedraw |
                ControlStyles.SupportsTransparentBackColor, true);
            BackColor = Color.Transparent;
        }

        protected override void OnPaint(PaintEventArgs e)
        {
            e.Graphics.SmoothingMode = SmoothingMode.AntiAlias;
            e.Graphics.TextRenderingHint = TextRenderingHint.AntiAliasGridFit;
            using (StringFormat format = new StringFormat(StringFormat.GenericTypographic))
            {
                format.Alignment = StringAlignment.Near;
                format.LineAlignment = StringAlignment.Near;
                for (int offset = 4; offset >= 1; offset--)
                {
                    using (SolidBrush glow = new SolidBrush(Color.FromArgb(12, GlowColor)))
                    {
                        e.Graphics.DrawString(Text, Font, glow,
                            new RectangleF(-offset, -offset, Width + offset * 2, Height + offset * 2), format);
                        e.Graphics.DrawString(Text, Font, glow,
                            new RectangleF(offset, offset, Width - offset * 2, Height - offset * 2), format);
                    }
                }
                using (SolidBrush main = new SolidBrush(ForeColor))
                {
                    e.Graphics.DrawString(Text, Font, main, new PointF(0, 0), format);
                }
            }
        }
    }

    internal sealed class CardPanel : Panel
    {
        public int Radius = 16;
        public Color FillColor = Color.FromArgb(17, 20, 26);
        public Color BorderColor = Color.FromArgb(36, 42, 54);

        public CardPanel()
        {
            SetStyle(ControlStyles.AllPaintingInWmPaint | ControlStyles.UserPaint |
                ControlStyles.OptimizedDoubleBuffer | ControlStyles.ResizeRedraw, true);
            BackColor = FillColor;
        }

        protected override void OnResize(EventArgs eventargs)
        {
            base.OnResize(eventargs);
            using (GraphicsPath path = Rounded(ClientRectangle, Radius))
            {
                Region = new Region(path);
            }
        }

        protected override void OnPaint(PaintEventArgs e)
        {
            e.Graphics.SmoothingMode = SmoothingMode.AntiAlias;
            using (GraphicsPath path = Rounded(ClientRectangle, Radius))
            using (SolidBrush fill = new SolidBrush(FillColor))
            using (Pen border = new Pen(BorderColor, 1))
            {
                e.Graphics.FillPath(fill, path);
                e.Graphics.DrawPath(border, path);
            }
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
            e.Graphics.SmoothingMode = SmoothingMode.AntiAlias;
            using (SolidBrush glow = new SolidBrush(Color.FromArgb(35, dotColor)))
            {
                e.Graphics.FillEllipse(glow, 0, 0, Width, Height);
            }
            using (SolidBrush brush = new SolidBrush(dotColor))
            {
                e.Graphics.FillEllipse(brush, 2, 2, Width - 4, Height - 4);
            }
        }
    }

    internal enum ButtonKind { Primary, Ghost, Danger }

    internal sealed class FlatButton : Button
    {
        public ButtonKind Kind = ButtonKind.Ghost;

        public FlatButton()
        {
            SetStyle(ControlStyles.OptimizedDoubleBuffer | ControlStyles.ResizeRedraw, true);
            FlatStyle = FlatStyle.Flat;
            FlatAppearance.BorderSize = 1;
            UseVisualStyleBackColor = false;
            TextAlign = ContentAlignment.MiddleCenter;
            Cursor = Cursors.Hand;
        }

        public void ApplyStyle()
        {
            if (Kind == ButtonKind.Primary)
            {
                BackColor = Color.FromArgb(47, 233, 255);
                ForeColor = Color.FromArgb(4, 20, 26);
                FlatAppearance.BorderColor = Color.FromArgb(31, 224, 255);
                FlatAppearance.MouseOverBackColor = Color.FromArgb(15, 184, 221);
                FlatAppearance.MouseDownBackColor = Color.FromArgb(8, 147, 184);
            }
            else if (Kind == ButtonKind.Danger)
            {
                BackColor = Color.FromArgb(42, 22, 27);
                ForeColor = Color.FromArgb(255, 138, 150);
                FlatAppearance.BorderColor = Color.FromArgb(110, 255, 77, 94);
                FlatAppearance.MouseOverBackColor = Color.FromArgb(58, 26, 33);
                FlatAppearance.MouseDownBackColor = Color.FromArgb(75, 30, 39);
            }
            else
            {
                BackColor = Color.FromArgb(21, 25, 34);
                ForeColor = Color.FromArgb(233, 237, 245);
                FlatAppearance.BorderColor = Color.FromArgb(36, 42, 54);
                FlatAppearance.MouseOverBackColor = Color.FromArgb(35, 42, 55);
                FlatAppearance.MouseDownBackColor = Color.FromArgb(45, 53, 68);
            }
        }

        protected override void OnResize(EventArgs eventargs)
        {
            base.OnResize(eventargs);
            using (GraphicsPath path = Rounded(ClientRectangle, Height / 2))
            {
                Region = new Region(path);
            }
        }

        private static GraphicsPath Rounded(Rectangle rectangle, int radius)
        {
            GraphicsPath path = new GraphicsPath();
            int diameter = Math.Max(2, Math.Min(radius * 2, Math.Min(rectangle.Width, rectangle.Height)));
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
