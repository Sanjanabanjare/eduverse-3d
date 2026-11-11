/* Study groups helpers (slice 3, advanced-features round — collaborative learning).
 *
 * Persistent student-owned collaboration spaces: a group with members, shared notes
 * (last-writer-wins) and group chat that lives beyond a single live session.
 * No new deps. Invite codes are 8 chars from an unambiguous alphabet.
 */

const MAX_GROUP_NAME = 120;
const MAX_GROUP_DESC = 500;
const MAX_NOTE_TITLE = 120;
const MAX_NOTE_CHARS = 20000;
const MAX_MESSAGE_CHARS = 500;
const MAX_MESSAGES_PER_GROUP = 200;

const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'; // no 0/O, 1/I/L

function generateInviteCode(existing) {
  const taken = new Set((existing || []).map(g => String(g.inviteCode || '').toUpperCase()));
  for (let attempt = 0; attempt < 50; attempt++) {
    let code = '';
    for (let i = 0; i < 8; i++) code += CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)];
    if (!taken.has(code)) return code;
  }
  // Extremely unlikely fallback: timestamp-derived code.
  return 'G' + Date.now().toString(36).toUpperCase().slice(-7);
}

function isMember(group, userId) {
  return !!(group && Array.isArray(group.members) && group.members.some(m => m.userId === userId));
}
function memberRole(group, userId) {
  const m = (group.members || []).find(x => x.userId === userId);
  return m ? m.role : null;
}
function canModerate(group, userId) {
  return group.ownerId === userId || memberRole(group, userId) === 'admin';
}

function validateGroupInput(body) {
  const b = (body && typeof body === 'object' && !Array.isArray(body)) ? body : {};
  const name = String(b.name || '').trim();
  if (name.length < 3 || name.length > MAX_GROUP_NAME) throw new Error('Group name must be 3 to 120 characters.');
  const description = String(b.description || '').trim().slice(0, MAX_GROUP_DESC);
  const courseId = (typeof b.courseId === 'string' && b.courseId.trim()) ? b.courseId.trim().slice(0, 80) : null;
  return { name, description, courseId };
}

function validateNoteInput(body) {
  const b = (body && typeof body === 'object' && !Array.isArray(body)) ? body : {};
  const title = String(b.title || '').trim();
  if (!title || title.length > MAX_NOTE_TITLE) throw new Error('Note title is required (max 120 characters).');
  const content = String(b.content || '');
  if (!content.trim()) throw new Error('Note content is required.');
  if (content.length > MAX_NOTE_CHARS) throw new Error('Note is too long (20,000 characters max).');
  return { title, content };
}

function validateNoteUpdate(body) {
  const b = (body && typeof body === 'object' && !Array.isArray(body)) ? body : {};
  const out = {};
  if (b.title !== undefined) {
    const title = String(b.title || '').trim();
    if (!title || title.length > MAX_NOTE_TITLE) throw new Error('Note title is required (max 120 characters).');
    out.title = title;
  }
  if (b.content !== undefined) {
    const content = String(b.content || '');
    if (!content.trim()) throw new Error('Note content is required.');
    if (content.length > MAX_NOTE_CHARS) throw new Error('Note is too long (20,000 characters max).');
    out.content = content;
  }
  if (Object.keys(out).length === 0) throw new Error('Nothing to update — provide a title or content.');
  return out;
}

function validateMessageInput(body) {
  const b = (body && typeof body === 'object' && !Array.isArray(body)) ? body : {};
  const text = String(b.text || '').trim();
  if (!text) throw new Error('Message text is required.');
  if (text.length > MAX_MESSAGE_CHARS) throw new Error('Message is too long (500 characters max).');
  return { text };
}

/** Public group view: member count + course title, invite code visible to members only
 *  (every route that returns a group already requires membership). */
function publicGroup(group, store) {
  const course = group.courseId ? (store.courses || []).find(c => c.id === group.courseId) : null;
  return {
    id: group.id, name: group.name, description: group.description || '',
    courseId: group.courseId || null, courseTitle: course ? course.title : null,
    ownerId: group.ownerId, inviteCode: group.inviteCode,
    memberCount: (group.members || []).length,
    members: (group.members || []).map(m => ({ userId: m.userId, name: m.name, role: m.role, joinedAt: m.joinedAt })),
    createdAt: group.createdAt,
  };
}

function publicNote(note, store) {
  const author = (store.users || []).find(u => u.id === note.authorId);
  return {
    id: note.id, groupId: note.groupId, authorId: note.authorId,
    authorName: author ? author.name : (note.authorName || 'Member'),
    title: note.title, content: note.content,
    updatedAt: note.updatedAt, lastEditedBy: note.lastEditedBy || note.authorId,
    createdAt: note.createdAt,
  };
}

module.exports = {
  MAX_GROUP_NAME, MAX_GROUP_DESC, MAX_NOTE_TITLE, MAX_NOTE_CHARS,
  MAX_MESSAGE_CHARS, MAX_MESSAGES_PER_GROUP,
  generateInviteCode, isMember, memberRole, canModerate,
  validateGroupInput, validateNoteInput, validateNoteUpdate, validateMessageInput,
  publicGroup, publicNote,
};
