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
    heading: 'Start here',
    blocks: [
      { kind: 'p', body: 'STREETO is the street-car network: a wall for your car life, builds and garages, crews, meetups, direct chat, parts, workshops and the people behind them.' },
      { kind: 'p', body: 'It runs in the browser on desktop and as an app on Android and iPhone. Phones and tablets use the same five-item tab bar; desktop keeps the sidebar.' },
    ],
  },
  {
    icon: 'wall',
    heading: 'The wall',
    blocks: [
      { kind: 'p', body: 'Post text, a photo, a video, a pin drop or an SOS. Choose Public or Friends only for every post - friends first or the whole network, your call.' },
      { kind: 'p', body: 'Like, comment, reply, react, edit or delete your own posts. Group posts stay in their group; the wall is the main feed.' },
    ],
  },
  {
    icon: 'garage',
    heading: 'Builds and the garage',
    blocks: [
      { kind: 'p', body: 'A build is the home for your car: photos and clips, engine, drivetrain, power, weight, mods and the story. Public builds can be seen by everyone; private builds stay yours.' },
      { kind: 'p', body: 'Link a build to My Ride so the car and its registration certificate stay together. Follow builds you like, vote for Build of the Week, and mark a public build for sale with a price.' },
      { kind: 'p', body: 'Build of the Week, Month and Year are decided by driver votes. Watchers get a notification when a build goes up for sale.' },
    ],
  },
  {
    icon: 'key',
    heading: 'My Ride and the registration certificate',
    blocks: [
      { kind: 'p', body: 'Add your personal vehicle from its registration certificate (technical passport). Scan the card with the camera or type the fields; STREETO fills what it can read.' },
      { kind: 'p', body: 'The certificate, plate, VIN and owner details are private to you. Odometer, maintenance, oil changes and parts are tracked in My Ride.' },
      { kind: 'p', body: 'On Android the scanner uses the app camera; on iPhone the scan opens the iPhone camera directly.' },
    ],
  },
  {
    icon: 'check',
    heading: 'Technical inspection and fines',
    blocks: [
      { kind: 'p', body: 'A green, red or grey badge shows the annual technical inspection for every build and My Ride vehicle with a plate. Public pages show the status and date, never the plate.' },
      { kind: 'p', body: 'Check fines from My Garage → Fines. Pay online through TBC, Bank of Georgia or Liberty.' },
      { kind: 'p', body: 'Fines stay private to the owner and update when you check them again.' },
    ],
  },
  {
    icon: 'shield',
    heading: 'Groups and crews',
    blocks: [
      { kind: 'p', body: 'Groups have their own feed, member list and meetups. Open groups accept anyone, private groups need approval, invite-only groups stay hidden until invited.' },
      { kind: 'p', body: 'Inside a group, members can post photos, clips, discussion and location pins for a meetup spot or emergency help.' },
    ],
  },
  {
    icon: 'pin',
    heading: 'Meetups and Touge routes',
    blocks: [
      { kind: 'p', body: 'Host a meetup with a title, date and spot: search a street, use GPS or tap the map. Set open, private or invite-only.' },
      { kind: 'p', body: 'See who is going, get directions, weather and a Touge route with start and finish, elevation and a 3D preview.' },
      { kind: 'p', body: 'Private and invite-only spots stay hidden from logged-out visitors.' },
    ],
  },
  {
    icon: 'chat',
    heading: 'Chat',
    blocks: [
      { kind: 'p', body: 'The global channel is open to every driver. Private threads are one-to-one and support replies, reactions, edits, attachments and search.' },
      { kind: 'p', body: 'Mute a chat without leaving it; unread messages show in the Chat tab and the notification bell.' },
    ],
  },
  {
    icon: 'users',
    heading: 'Drivers and friends',
    blocks: [
      { kind: 'p', body: 'Find drivers by username, name, city or car. Send a friend request; friends appear first on your wall.' },
      { kind: 'p', body: 'Send a direct message, see presence and open a profile.' },
    ],
  },
  {
    icon: 'search',
    heading: 'Explore, search and near you',
    blocks: [
      { kind: 'p', body: 'Explore brings builds, groups, services, drivers, friends and meetups into one place. Search looks across drivers, groups, meetups, builds, parts and services.' },
      { kind: 'p', body: 'Near you uses your location or city to find meetups, crews and drivers around you.' },
    ],
  },
  {
    icon: 'wrench',
    heading: 'Parts and services',
    blocks: [
      { kind: 'p', body: 'The Services area has a Parts board and a Maintenance directory. List a part with photos and a price, or find a workshop, tuner, painter or detailer.' },
      { kind: 'p', body: 'Workshops show contact details, map and directions. Drivers can leave a 1-5 star review; one review per driver per listing.' },
      { kind: 'p', body: 'Use GEL or USD for prices; switch currency and everything converts.' },
    ],
  },
  {
    icon: 'settings',
    heading: 'Notifications, themes and settings',
    blocks: [
      { kind: 'p', body: 'Choose push notifications for messages, friend requests, comments, likes, invites and meetups. Muted chats stay quiet.' },
      { kind: 'p', body: 'Pick Street, Black & Gold or White & Gold; your theme follows your account. Manage profile, password and language in Settings.' },
      { kind: 'p', body: 'The footer and Settings show the current web/iOS and Android versions.' },
    ],
  },
  {
    icon: 'download',
    heading: 'Android app',
    blocks: [
      { kind: 'p', body: 'Download the signed APK from the Install page, open it on your phone and allow installs from the browser when Android asks. Android 7.0 or newer.' },
      { kind: 'p', body: 'The app adds the phone camera and gallery, GPS, pull-to-refresh, the Android back button, an offline screen and native Android notifications.' },
      { kind: 'p', body: 'Updates are built into the app: when a new APK is available, STREETO shows an update banner and installs it after your confirmation.' },
      { kind: 'p', body: 'Android uses the same five-item tab bar as iPhone and the PWA.' },
    ],
  },
  {
    icon: 'phone',
    heading: 'iPhone and iPad',
    blocks: [
      { kind: 'p', body: 'Open streeto.net in Safari, tap Share, then Add to Home Screen. STREETO opens full screen and keeps you signed in.' },
      { kind: 'p', body: 'Push notifications work on iOS 16.4+ after the app is on the Home Screen. Allow notifications in Settings when asked.' },
      { kind: 'p', body: 'The iPhone app shares the same tab bar, fonts and offline screen. The certificate scanner opens the iPhone camera directly.' },
      { kind: 'p', body: 'The iOS version is shown in Settings and the site footer.' },
    ],
  },
  {
    icon: 'lock',
    heading: 'Privacy and your account',
    blocks: [
      { kind: 'p', body: 'Choose Public or Friends only for every post. Your certificate, fines, plate and personal details are only shown to you.' },
      { kind: 'p', body: 'Your password is stored with scrypt, never plain text. You can delete your account from Settings.' },
      { kind: 'p', body: 'Language, theme and currency follow your account on every device you log in from.' },
    ],
  },
];

export default HOW_IT_WORKS_SEED;
