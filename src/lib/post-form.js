import { cleanText, checkCoords, checkZoom } from './validate.js';
import { mediaKind, removeUpload } from './uploads.js';
import * as posts from '../models/posts.js';
import * as polls from '../models/polls.js';

/**
 * Turn a composer submission (wall or group) into a post row.
 *
 * Rules:
 *  - an uploaded file decides photo/video
 *  - otherwise a pin turns it into a location share
 *  - `post_type=emergency` (SOS) needs a pin and is flagged for help
 *  - a post must carry text, media or a pin - never nothing
 */
export function buildPost(req, { userId, groupId = null }) {
  const file = req.file || null;
  const body = cleanText(req.body.body ?? '', 5000);
  const wanted = String(req.body.post_type || '').toLowerCase();
  const coords = checkCoords(req.body.lat, req.body.lng);
  const placeName = cleanText(req.body.place_name ?? '', 160) || null;
  const address = cleanText(req.body.address ?? '', 240) || null;

  // The poll is read up front: a poll is a post on its own, so it does
  // not need the "what happened" text on top of it.
  const pollQuestion = cleanText(req.body.poll_question ?? '', 200);
  const pollOptions = (Array.isArray(req.body.poll_option) ? req.body.poll_option : [req.body.poll_option])
    .map((o) => cleanText(o ?? '', 80))
    .filter(Boolean);
  const wantsPoll = Boolean(pollQuestion) || pollOptions.length > 0;
  if (wantsPoll && (!pollQuestion || pollOptions.length < 2)) {
    return { ok: false, error: 'A poll needs a question and at least two options.' };
  }

  const discardFile = () => {
    if (file) removeUpload(file.filename);
  };

  let mediaType = null;
  let mediaPath = null;
  let postType = 'text';

  if (file) {
    mediaType = mediaKind(file.mimetype);
    if (!mediaType) {
      discardFile();
      return { ok: false, error: 'That file type is not supported. Use JPG/PNG/WebP/GIF or MP4/WebM/MOV.' };
    }
    mediaPath = file.filename;
    postType = mediaType;
  } else if (wanted === 'location' || wanted === 'emergency' || (req.body.lat && req.body.lng)) {
    if (!coords.ok) {
      return { ok: false, error: 'Pick a spot first - search a street name or use your GPS.' };
    }
    postType = wanted === 'emergency' ? 'emergency' : 'location';
  }

  if (!body && !mediaPath && postType === 'text' && !wantsPoll) {
    return { ok: false, error: 'Add some text, a photo/video, or drop a pin.' };
  }

  if (postType === 'emergency' && !coords.ok) {
    return { ok: false, error: 'An SOS post needs your location so people can find you.' };
  }

  const id = posts.createPost({
    userId,
    groupId,
    body: body || null,
    postType,
    mediaType,
    mediaPath,
    placeName,
    address,
    lat: coords.ok ? coords.lat : null,
    lng: coords.ok ? coords.lng : null,
    // The zoom the map was left at, so the shared map opens the same way.
    zoom: coords.ok ? checkZoom(req.body.zoom) : null,
    // Group posts follow the group's privacy, so only wall posts get a
    // public/friends choice.
    privacy: groupId ? 'public' : (req.body.privacy === 'friends' ? 'friends' : 'public'),
  });

  // The poll itself
  if (wantsPoll) {
    try {
      polls.createPoll(id, pollQuestion, pollOptions.slice(0, 6));
    } catch (e) {
      // poll creation failure shouldn't kill the post
    }
  }

  return { ok: true, id, postType };
}

export default buildPost;
