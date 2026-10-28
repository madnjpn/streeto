import { all } from '../db.js';
import * as groups from '../models/groups.js';
import * as meetups from '../models/meetups.js';
import * as notifications from '../models/notifications.js';

/** Who should hear that a meetup was just created. */
function meetupAudience(meetup) {
  if (meetup.group_id) return groups.members(meetup.group_id).map((person) => person.id);
  // Invite-only runs stay quiet until the host invites people. Open and
  // private runs are listed publicly, so everyone can hear about them.
  if (meetup.privacy === 'invite') return [];
  return all('SELECT id FROM users').map((row) => row.id);
}

/** A new meetup is worth a push, not just a line in the meetup list. */
export function announceMeetup(meetup, actorId) {
  for (const userId of meetupAudience(meetup)) {
    notifications.notify({
      userId,
      actorId,
      type: 'meetup_new',
      entityId: meetup.id,
      url: `/meetups/${meetup.id}`,
      text: 'New meetup: {name}|' + meetup.title,
    });
  }
}

/** Tell everyone who had a spot, asked for one, or was invited. */
export function announceMeetupCancelled(meetup, actorId) {
  const people = meetups.attendees(meetup.id);
  for (const person of people) {
    notifications.notify({
      userId: person.id,
      actorId,
      type: 'meetup_cancelled',
      entityId: meetup.id,
      url: '/meetups',
      text: 'Meetup cancelled: {name}|' + meetup.title,
    });
  }
}

export default { announceMeetup, announceMeetupCancelled };
