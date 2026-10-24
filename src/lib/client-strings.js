/**
 * Strings the browser scripts need.
 *
 * The client can't call the server dictionary, so every key used by
 * `public/js/*.js` is listed here and shipped to the page as a JSON map
 * (see views/partials/i18n-data.ejs). Keys are the English source
 * strings, exactly like the server templates, so a missing translation
 * degrades to English rather than to a placeholder.
 */
export const CLIENT_KEYS = [
  /* api / generic */
  'Server error ({status})',
  'Request failed ({status})',
  'Close',
  'Preview',

  /* polls */
  'Option {n}',
  'Confirm',
  'Delete',
  'Remove',
  'A poll needs a question and at least two options.',

  /* lightbox */
  'Photo viewer',

  /* comments */
  'No comments yet. Be the first.',
  'Delete this comment?',

  /* friends */
  'Friends',
  'Requested',
  'Add friend',
  'You and @{user} are friends.',
  'Request sent to @{user}.',
  'Friend request accepted.',
  'Request declined.',
  'Remove @{user} from your group?',
  '@{user} removed.',

  /* composer */
  'Send SOS',
  'Post',
  'SOS posts need a pin so people can find you. Only use this for real emergencies.',
  'Drop a pin or use your GPS first.',
  'Write something or attach a photo/video.',

  /* auth */
  'Hide password',
  'Show password',

  /* builds */
  'Voted this week',
  'Vote build of the week',
  'Vote moved to this build.',
  'Vote locked in for build of the week.',
  'Vote withdrawn.',
  'You are watching this car',
  'Notify me when it is for sale',
  'Noted. We will tell you when this car goes up for sale.',
  'This car is off your watch list.',
  'Watch this car',
  'Stop watching',

  /* map picker */
  'Searching…',
  'Naming that spot…',
  'No matches. Try a different street name, or tap the map.',
  'Type at least 3 characters to search.',
  '{n} match - pick one.',
  '{n} matches - pick one.',
  'Pinned: {name}',
  'unnamed spot',
  'Unnamed spot',
  'spot',
  'Pinned. Street search could not name it - type a name below.',
  'Pinned. Type a name below if you want.',
  'Search failed. You can still tap the map.',
  'This browser has no GPS support. Tap the map instead.',
  'Getting your position…',
  'Location permission denied. Tap the map or search a street instead.',
  'Could not get a GPS fix. Tap the map or search a street instead.',
  'Map library missing - run `npm install` and restart. You can still type a spot name.',
  'Map unavailable',
  'Pin cleared. Tap the map to drop a new one.',
  'Pin saved at {lat}, {lng}',
  'Open in Google Maps',
  'Saved spot loaded - move the pin if you like.',
  'Tap the map to drop a pin, search a street, or use your GPS.',

  /* chat */
  'Message failed to send.',
  'Attached: {name} ({size} MB)',
  'You',
  'No messages yet.',
  'No chats yet.',

  /* composer audience */
  'everyone can see it',
  'only your friends can see it',

  /* live search */
  'Drivers',
  'Groups',
  'Meetups',
  'Builds',
  'Parts',
  'Services',
  'Open',
  'Private',
  'Invite only',
  'Searching…',
  'Search failed. Try again.',
  'No matches for "{q}".',
  'See all results',

  /* admin console - translations and the manual editor */
  'Saving…',
  'Saved',
  'Not saved',
  'Remove this section and everything in it? The Georgian text goes with it.',
  'Remove this line? The Georgian text goes with it.',
  'Move up',
  'Move down',
  'Add line',
  'Add section',
  'New English line',
  'New section heading in English',
  'Section heading in English',
  'Georgian heading',
  'Georgian text',
  'English text',
  'Paragraph',
  'Bullet',
  'Icon',
  'Choose an icon',
  'All icons',
  'In use on the manual right now',
  'Shared: {what}',
  'build',
  'Post',
  'Meetup',
  'Part',
  'Service',
  // The scanner cannot see a string that sits inside a choice.
  'Change cover photo',
  'Add cover photo',

  /* admin console - translation checks */
  'The translation must keep the {name} placeholder - it is filled in when the page is rendered.',
  'The {name} tag is not closed - that would break the page.',
  'The English text has no {name} - it will show as plain text.',
  'The English text uses {name} - the bold or italic part will be lost.',

  /* touge route picker */
  'Clear route',
  'Tap to remove this pin',
  'Start (A) set. Tap the map for Finish (B).',
  'Start (A) set. Looking up the street name…',
  'Finish (B) set. Looking up the street name…',
  'Route ready. Tap a pin to move it, or Clear to restart.',
  'Start (A) removed. Tap the map to place it again.',
  'Finish (B) removed. Tap the map to place it again.',
  'Set Start (A) and Finish (B) first.',
  'Tap the map to set Start (A), then tap for Finish (B).',
  'Cleared. Tap the map to set Start (A).',
  'Not set',
  'Preview 3D route',
  'Exit preview',
  'Reset north',
  'Full screen',
  'Exit full screen',
  'Location permission denied. Tap the map instead.',
  'Could not get a GPS fix. Tap the map instead.',

  /* weather */
  'Clear',
  'Mostly clear',
  'Partly cloudy',
  'Overcast',
  'Fog',
  'Drizzle',
  'Freezing drizzle',
  'Rain',
  'Freezing rain',
  'Snow',
  'Snow grains',
  'Showers',
  'Snow showers',
  'Thunderstorm',
  'Thunderstorm with hail',
  'Expected weather',
  'Forecast for this date',
  '{n}% rain',
  '{n} mm rain',

  /* pinned street banner */
  'Pinned.',
  'Pinned. Street search could not name it.',

  /* part search */
  'A car from another market',
  'A chassis code has no check digit, so nobody can tell whether it was typed right - this is the car it belongs to.',
  'A chassis code has no check digit, so nobody can tell whether it was typed right. The maker\'s own catalogue is the only place that can read it.',
  'As the catalogues write it',
  'Body',
  'Chassis code',
  'Choose a make',
  'Choose a model',
  'Choose a year',
  'Choose an engine',
  'Choose the car in the catalogue',
  'Cylinders',
  'Displacement',
  'Doors',
  'Drive',
  'Engine',
  'Factory parts and diagrams',
  'Frame number',
  'Fuel',
  'Known as',
  'Loading...',
  'Look the same number up here too',
  'Looking in the catalogue...',
  'Looking...',
  'Made in',
  'No groups for that car.',
  'No models found for this make and year. Try a different year.',
  'No technical passport yet',
  'Nothing found for that number.',
  'Nothing found in that group.',
  'Open My Ride',
  'Reading the VIN...',
  'Reading the number...',
  'Search parts with this code',
  'See it at RockAuto',
  'See the parts for this car',
  'Serial number',
  'Something went wrong.',
  'That car is not in the parts catalogue.',
  'The catalogue does not list {name} - pick the model from the list.',
  'The catalogue has no tree for this car - pick the group, or search by part number.',
  'The catalogue is not answering for the engines - the parts are still searched by make, year and model.',
  'The catalogue lists this car only as {name}.',
  'The check digit of the VIN is right, so the number reads clean.',
  'The factory catalogue',
  'The ninth character is not a check digit - outside North America it usually is not one.',
  'The number could not be read, so the car was picked from what the garage knows. Choose the engine.',
  'The parts catalogue is not answering right now. Showing cached data if available, or you can type the model manually.',
  'The parts catalogue is not answering right now. You can still type the year manually or try again later.',
  'The register is not answering right now - choose the car by hand.',
  'The same car is sold as {name}',
  'The same car is sold under this name - the drivetrain parts are the same.',
  'This VIN is not in the North American register - it is a car from another market.',
  'This code was built {years} - set the year of your car.',
  'Type the model',
  'Type the year',
  'Years',
  'Your garage is empty. Add a car and it shows up here.',
  '{n} parts found',

  /* versions & app updates */
  'Installed app version',
  'Latest Android app',
  'Installed',
  'New',
  'Downloading the update…',
  'A new version of STREETO is available: v{version}.',
  'Checking…',
  'Update available: v{version}.',
  "You're on the latest version (v{version}).",
  'A new web version is available. Reload the page to get it.',
  'The web version is up to date (v{version}).',
  'Check failed. Try again.',
  'Allow installs for STREETO, then tap Update again.',
  'Could not start the update. Try again.',
];

/** Build the key -> translation map handed to the browser. */
export function buildClientStrings(t) {
  const out = {};
  for (const key of CLIENT_KEYS) out[key] = t(key);
  return out;
}

export default { CLIENT_KEYS, buildClientStrings };
