/**
 * The starting content of the "How it works" page.
 *
 * It is only used the first time the page is opened - after that the
 * content lives in the database and the admin console edits it. The
 * English text of every heading and block is the translation key, so a
 * Georgian translation belongs to exactly one line here.
 *
 * kind: 'p'  = a paragraph
 *       'li' = a bullet in the list that follows the previous paragraph
 */
export const HOW_IT_WORKS_SEED = [
  {
    icon: 'bolt',
    heading: "What's new",
    blocks: [
      { kind: 'p', body: 'A quick rundown of the latest additions. This list grows as the app does.' },
      { kind: 'li', body: '<strong>One dark theme everywhere</strong> - dropdown menus, modals and the yes/no confirmations all use the same dark panel, so native white system pop-ups are gone.' },
      { kind: 'li', body: '<strong>Group runs</strong> - a meetup hosted by a group shows the group name and links straight to the group page.' },
      { kind: 'li', body: '<strong>Pick your audience</strong> - every wall post is <strong>Public</strong> or <strong>Friends only</strong>, chosen right in the composer.' },
      { kind: 'li', body: '<strong>Floating chat box</strong> - new messages pop up in a corner window you can read and answer from any page, then minimise or close.' },
      { kind: 'li', body: '<strong>Quieter private spots</strong> - the location and map of a private or invite-only meetup stay hidden from logged-out visitors.' },
      { kind: 'li', body: '<strong>Smaller controls</strong> - buttons and fields are tighter, and the search bar matches every other input.' },
      { kind: 'li', body: '<strong>More admin powers</strong> - admins can now also delete any group, any group post and any build.' },
      { kind: 'li', body: '<strong>Smarter group cards</strong> - a group you already belong to shows <strong>View</strong> instead of an invite to join.' },
      { kind: 'li', body: '<strong>Admin console</strong> - admins can promote other drivers, hand the role over, and remove any driver, post or meetup.' },
      { kind: 'li', body: '<strong>Database backups</strong> - admins can snapshot the whole database on demand, download or restore a snapshot, and the server also backs up automatically every six hours.' },
      { kind: 'li', body: '<strong>Services board</strong> - a new <strong>Services</strong> tab with a buy-and-sell <strong>Parts</strong> board and a <strong>Maintenance</strong> directory of workshops, with map pins, contact details and star reviews.' },
      { kind: 'li', body: '<strong>Three looks</strong> - pick <strong>Street</strong>, <strong>Black &amp; Gold</strong> or <strong>White &amp; Gold</strong> in Settings. Your choice follows you to every device you log in from.' },
      { kind: 'li', body: '<strong>Sell your build</strong> - tick <strong>for sale</strong> on any build, name a price, and it lands under <strong>Builds &gt; For sale</strong> for buyers to find.' },
      { kind: 'li', body: '<strong>Two currencies</strong> - price a part or a car in <strong>lari</strong> or <strong>US dollars</strong>. Read prices in whichever you like - STREETO converts between GEL and USD for you.' },
      { kind: 'li', body: '<strong>Watch a car</strong> - tap <strong>Notify me</strong> on a build you would buy and STREETO pings you the moment the owner puts it up for sale.' },
      { kind: 'li', body: '<strong>Sale cars on Explore</strong> - the Explore page now has a <strong>Builds for sale</strong> row, and the search bar also looks through <strong>parts</strong> and <strong>services</strong>.' },
      { kind: 'li', body: '<strong>Technical inspection badges</strong> - every build and My Ride vehicle shows a green/red/grey badge for its annual technical inspection, checked automatically from pti.ge. Public visitors see the status and date, never the plate.' },
      { kind: 'li', body: '<strong>Odometer sync</strong> - the odometer reading is shared between a build and its linked My Ride vehicle; edit it in either place and both update.' },
      { kind: 'li', body: '<strong>Registration certificate sync</strong> - link a build to one of your My Ride vehicles to pull and keep its registration-certificate details in step on both sides.' },
      { kind: 'li', body: '<strong>Fines with Liberty</strong> - fines can be paid online through TBC, Bank of Georgia or Liberty.' },
      { kind: 'li', body: '<strong>Privacy on build pages</strong> - public visitors see the inspection status but never the plate, the owner details or a plate-bearing link.' },
    ],
  },
  {
    icon: 'wall',
    heading: 'The wall',
    blocks: [
      { kind: 'p', body: 'Your home feed has two tabs. <strong>My group</strong> shows your posts and your friends\' posts. <strong>Everyone</strong> shows every public post on the network. Post text, one photo or one video, a pin drop, or an SOS location. Choose who sees it - <strong>Public</strong> for the whole network, or <strong>Friends only</strong> for your friends. You can delete any post you made - group admins can moderate their own group\'s feed.' },
    ],
  },
  {
    icon: 'users',
    heading: 'Friends',
    blocks: [
      { kind: 'p', body: 'Search drivers by username, display name, city or car. Send a request, they accept, you\'re friends. Friends show up first on your wall, and their posts are the ones you actually care about.' },
    ],
  },
  {
    icon: 'search',
    heading: 'Search',
    blocks: [
      { kind: 'p', body: 'One search box looks everywhere. Start typing and matches drop down under the field - drivers, groups, meetups, builds, parts and services. Press the arrow keys to pick one, or hit Search for the full results page with tabs for each kind.' },
    ],
  },
  {
    icon: 'chat',
    heading: 'Chat',
    blocks: [
      { kind: 'p', body: 'There are two channels. The <strong>global channel</strong> is open to every driver on the network - one shared pit lane. <strong>Private threads</strong> are 1-to-1: anyone can message anyone. Deleting a private chat removes it from <em>your</em> inbox only - the other person keeps their copy, and the thread comes back if they write again. The global channel belongs to everyone and can\'t be deleted.' },
      { kind: 'p', body: 'When a message arrives, a small chat box opens in the corner of the screen with your recent threads. Open one to read and reply without leaving the page, then minimise it out of the way or close it until the next message.' },
    ],
  },
  {
    icon: 'garage',
    heading: 'Builds',
    blocks: [
      { kind: 'p', body: 'Upload your car with photos, a clip and a spec sheet - engine, drivetrain, power, weight, mods and the story. Builds can be <strong>public</strong> or <strong>private</strong> (yours only).' },
      { kind: 'p', body: 'Selling it? Tick <strong>for sale</strong> on the build, name a price (or leave it blank for "ask") and add a note like "negotiable". The build then shows up under <strong>Builds &gt; For sale</strong>, where another driver can message you in one tap. Only public builds go on the market.' },
      { kind: 'p', body: 'Not selling yet? Tap <strong>Notify me</strong> on another driver\'s build to keep an eye on it. The day the owner puts that car up for sale you get a notification and a push, so the car you want never slips past you.' },
      { kind: 'p', body: 'Every driver gets <strong>one vote per week</strong> for the build of the week, and can change it any time before the week closes. The most-voted build of a finished week becomes <strong>Build of the Week</strong>. Four weekly wins inside one calendar month upgrade it to <strong>Build of the Month</strong>, and a build whose yearly win count beats the rest of the field\'s average takes <strong>Build of the Year</strong>.' },
    ],
  },
  {
    icon: 'key',
    heading: 'My Ride and registration certificate',
    blocks: [
      { kind: 'p', body: '<strong>My Ride</strong> keeps your personal vehicle in the garage: add it from its registration certificate (tech passport) by scanning or typing the fields, and track maintenance, oil changes and parts replaced. When a build is <strong>linked</strong> to one of your My Ride vehicles, the registration-certificate details are copied both ways and stay in step - edit them on either side and the other follows.' },
      { kind: 'p', body: '<strong>Scanning the card</strong> sends the photo of the certificate to Google Gemini, which reads the printed fields and fills the form for you: the plate, year, dates, owner details, technical passport number, make, model, VIN, engine capacity, fuel and colour. The card is read in both spellings, so a field that the document prints as "ბენზინი / Gasoline" is stored as "Gasoline / ბენზინი" - Latin first, Georgian right after it. The photo is only read on the server and is deleted as soon as the fields are extracted.' },
      { kind: 'p', body: '<strong>Owner details stay private</strong>: the full certificate - passport number, VIN, plate, engine number and owner data - is only shown to you, even on a public build page.' },
    ],
  },
  {
    icon: 'check',
    heading: 'Technical inspection',
    blocks: [
      { kind: 'p', body: 'Every build and My Ride vehicle with a number plate shows a badge for its <strong>annual technical inspection</strong>, checked automatically against <strong>pti.ge</strong> when you add or edit it. The badge is <strong>green</strong> when valid, <strong>red</strong> when expired, and <strong>grey</strong> when it could not be checked. Public visitors see the status and the date, never the plate or a plate-bearing link; the badge is hidden entirely when there is no plate. Stored results refresh on their own as they go stale.' },
    ],
  },
  {
    icon: 'settings',
    heading: 'Odometer',
    blocks: [
      { kind: 'p', body: 'The <strong>odometer reading</strong> lives on both the build and the linked My Ride vehicle and is kept in step: type it in the build editor or tap the reading in My Ride to edit it, and the other side updates. It also shows on the build card and the build\'s spec sheet.' },
    ],
  },
  {
    icon: 'alert',
    heading: 'Fines',
    blocks: [
      { kind: 'p', body: 'Check your fines from <strong>My Garage > Fines</strong> by picking one of your vehicles. Payable fines can be settled online through <strong>TBC</strong>, <strong>Bank of Georgia</strong> or <strong>Liberty</strong>, each opening its own checkout.' },
    ],
  },
  {
    icon: 'shield',
    heading: 'Groups',
    blocks: [
      { kind: 'p', body: 'Groups come with their own feed, member list and meetups.' },
      { kind: 'li', body: '<strong>Open</strong> - anyone can see it and join instantly.' },
      { kind: 'li', body: '<strong>Private</strong> - anyone can see it, but an admin approves each new member.' },
      { kind: 'li', body: '<strong>Invite only</strong> - hidden from the directory. Members invite their friends; admins can invite anyone.' },
      { kind: 'p', body: 'Inside a group you can post photos, clips, discussion and location pins - for a meetup spot or for emergency help.' },
    ],
  },
  {
    icon: 'pin',
    heading: 'Meetups',
    blocks: [
      { kind: 'p', body: 'Anybody can host. Pick a title, date and time, then choose the spot:' },
      { kind: 'li', body: 'Type a street name, venue or postcode and pick it from the search results.' },
      { kind: 'li', body: 'Or tap <strong>Use my GPS</strong> to pin wherever you are standing.' },
      { kind: 'li', body: 'Or tap the map to drop a pin manually.' },
      { kind: 'p', body: 'Privacy works the same way as groups: open runs anyone can join, private runs need host approval, invite-only runs stay hidden until the host invites you. Host a run from a group page and the meetup carries the group name, so it shows up on the card and on the run page with a link back to the group.' },
      { kind: 'p', body: 'For private and invite-only runs the exact spot stays hidden from logged-out visitors - they see the name, the date and who is going, and the map appears once they log in. Open runs show everything to everyone.' },
    ],
  },
  {
    icon: 'wrench',
    heading: 'Services',
    blocks: [
      { kind: 'p', body: 'The <strong>Services</strong> tab is two boards in one. <strong>Parts</strong> is a buy-and-sell board for car parts, and <strong>Maintenance</strong> is a directory of workshops and specialists. The tabs at the top switch between them.' },
      { kind: 'p', body: '<strong>Parts</strong> - post a part for sale with a title, a category (engine, drivetrain, exhausts, tuning, exterior, interior, wheels and tires, suspension, brakes, electrical or other), a price and an optional note like "negotiable" or "swap", a description, a phone number, a rough location and up to six photos. Buyers ring or message you directly, and you can mark a part <strong>sold</strong> when it goes.' },
      { kind: 'p', body: '<strong>Maintenance</strong> - list a shop or a specialist with a category (body repairs, body paint, electronics, drivetrain mechanic, engine mechanic, ECU tuning, dyno, detailing, tires and wheels), a short description, a phone number and an email, a cover photo, and a pin on the map. The map and a <strong>Get directions</strong> button sit on the listing.' },
      { kind: 'p', body: '<strong>Reviews</strong> - any driver can leave a <strong>1 to 5 star rating</strong> and a short comment on a maintenance listing. One review per driver per listing: writing again edits the old one, and you can remove it any time. You cannot review your own listing, and the average plus a live count sit at the top of every card.' },
      { kind: 'p', body: '<strong>Service provider badge</strong> - if you run a shop or work as a mechanic, tuner, painter or detailer, tick <strong>I offer car services</strong> in <em>Settings</em> and add a business name. A green provider badge then sits on your profile and on every service you post.' },
    ],
  },
  {
    icon: 'alert',
    heading: 'SOS posts',
    blocks: [
      { kind: 'p', body: 'Switch the composer to SOS and post with a pin. It\'s styled differently so nobody misses it. Use it for a breakdown, an accident, or a driver who needs a hand.' },
    ],
  },
  {
    icon: 'lock',
    heading: 'Your account',
    blocks: [
      { kind: 'p', body: 'Usernames are 3-20 characters, letters, numbers and underscores only. Passwords need at least 8 characters with a letter and a number, and are stored with scrypt - never in plain text. Sessions live in SQLite, and you can delete your account from Settings whenever you want.' },
    ],
  },
  {
    icon: 'database',
    heading: 'Admins and backups',
    blocks: [
      { kind: 'p', body: 'An admin is a normal driver with extra keys. From the <strong>admin console</strong> they can make another driver an admin, hand the role over, and delete any driver, post, group, group post, build or meetup. To keep the data safe, the server snapshots the whole database on its own every six hours; an admin can also take a snapshot on demand, browse the list, restore any snapshot and download a copy. Snapshots are written to the local <em>data/backups</em> folder.' },
    ],
  },
  {
    icon: 'palette',
    heading: 'Themes',
    blocks: [
      { kind: 'p', body: 'In <em>Settings</em> you can pick how STREETO looks: <strong>Street</strong> - the original dark asphalt with neon accents - <strong>Black &amp; Gold</strong>, or <strong>White &amp; Gold</strong>. Each is a full palette, so backgrounds, panels, text and accents all change together. Your choice is saved to your account and follows you to every device you log in from.' },
    ],
  },
  {
    icon: 'exchange',
    heading: 'Currency',
    blocks: [
      { kind: 'p', body: 'Prices can be quoted in <strong>GEL (₾)</strong> or <strong>USD ($)</strong>, and you choose which one each time you list - a part, or a car in <strong>Builds &gt; For sale</strong>. Switch the currency from the top bar or in <em>Settings</em> and every price is converted on the spot, with the seller\'s original figure kept underneath. Sorting by price compares everything in one currency, so the order stays honest.' },
      { kind: 'p', body: 'The conversion uses a fixed reference rate (configurable on the server with the <em>USD_TO_GEL</em> setting), so no internet connection is needed and the figures never jump around.' },
    ],
  },
  {
    icon: 'palette',
    heading: 'Appearance and fonts',
    blocks: [
      { kind: 'p', body: 'The <strong>Appearance</strong> tab of the admin console keeps two fonts at once: one for English and one for Georgian. Both apply together everywhere, so English letters use the English font and Georgian letters use the Georgian font on the same page. Each side can be a ready-made option or a file of your own (<em>.woff</em>, <em>.woff2</em>, <em>.ttf</em> or <em>.otf</em>, up to 5 MB). Say which script an upload covers - Latin, Georgian or both - and it appears under that language. The choice is stored on the server, so it applies to every visitor straight away and survives restarts - no redeploy needed.' },
    ],
  },
  {
    icon: 'wrench',
    heading: 'Service claims',
    blocks: [
      { kind: 'p', body: 'Any member can list a workshop or specialist on the <strong>Maintenance</strong> board and share it with other drivers. If the real owner joins later, they tick <strong>I offer car services</strong> in their settings, which unlocks the <strong>Claim</strong> button on the service card - admins review the request and, once approved, ownership transfers to the claimant, the listing gets a <strong>Verified</strong> badge, and the business name on their profile becomes the service name. A provider who publishes their own listing does not have to claim it: the claim is filed for them and an admin confirms it the same way. Until the claim is approved the previous owner keeps the name on their badge; afterwards the badge drops the listing that moved and falls back to a generic provider badge when they have no listings left.' },
    ],
  },
];

export default HOW_IT_WORKS_SEED;
