'use strict';
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { randomUUID, randomBytes, scrypt: scryptCallback, timingSafeEqual, createHmac } = require('node:crypto');
const https = require('node:https');
const { promisify } = require('node:util');
const { Transform } = require('node:stream');
const { spawn } = require('node:child_process');
const { createIdempotencyExecutor } = require('./idempotency');
const { csvEscape } = require('./csv');
const nova = require('./nova');
const quizgen = require('./quizgen');
const studygroups = require('./studygroups');
const { runCodeTests, isAttemptExpired } = require('./exam');
const live = require('./live');
const org = require('./org');
const ops = require('./ops');
const sec = require('./sec');
const storage = require('./storage');
const email = require('./email');
const payments = require('./payments');
const search = require('./search');
const cache = require('./cache');
const notify = require('./notify');
const monitor = require('./monitor');
const family = require('./family');
const library = require('./library');
const career = require('./career');
const lang = require('./lang');
const codelab = require('./codelab');
const standards = require('./standards');
const jwt = require('./jwt');
const google = require('./google');
const classroom = require('./classroom');
const scrypt = promisify(scryptCallback);

const PORT = Number(process.env.PORT || 4173);
const BIND_HOST = process.env.HOST || (process.env.NODE_ENV === 'production' ? '0.0.0.0' : '127.0.0.1');
const PROJECT_ROOT = path.resolve(__dirname, '..');
if (process.env.NODE_ENV === 'production') {
  if (String(process.env.JWT_SECRET || '').length < 32) {
    throw new Error('JWT_SECRET must be configured with at least 32 characters in production.');
  }
  if (!String(process.env.APP_BASE_URL || '').trim()) {
    throw new Error('APP_BASE_URL must be configured to the public HTTPS origin in production.');
  }
}
const APP_BASE_ORIGIN = (() => {
  const configured = String(process.env.APP_BASE_URL || '').trim();
  if (!configured) return '';
  let parsed;
  try { parsed = new URL(configured); }
  catch { throw new Error('APP_BASE_URL must be a valid absolute URL.'); }
  if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password) {
    throw new Error('APP_BASE_URL must be an absolute HTTP(S) URL without credentials.');
  }
  if (process.env.NODE_ENV === 'production' && parsed.protocol !== 'https:') {
    throw new Error('APP_BASE_URL must use HTTPS in production.');
  }
  return parsed.origin;
})();
const DEFAULT_STORE_PATH = path.join(__dirname, 'data', 'store.json');
const STORE_PATH = process.env.EDUVERSE_STORE_PATH || DEFAULT_STORE_PATH;
const COURSE_UPLOAD_DIR = path.join(path.dirname(STORE_PATH), 'course-uploads');
fs.mkdirSync(path.dirname(STORE_PATH), { recursive: true, mode: 0o700 });
fs.mkdirSync(COURSE_UPLOAD_DIR, { recursive: true, mode: 0o700 });
try { fs.chmodSync(COURSE_UPLOAD_DIR, 0o700); } catch {}
if (STORE_PATH === DEFAULT_STORE_PATH) { try { fs.chmodSync(path.dirname(STORE_PATH), 0o700); } catch {} }
if (!fs.existsSync(STORE_PATH)) {
  try { fs.writeFileSync(STORE_PATH, JSON.stringify({ users: [], adminAudit: [] }, null, 2), { flag: 'wx', mode: 0o600 }); }
  catch (error) { if (error.code !== 'EEXIST') throw error; }
}
try { fs.chmodSync(STORE_PATH, 0o600); } catch {}
let store = JSON.parse(fs.readFileSync(STORE_PATH, 'utf8'));
let writeQueue = Promise.resolve();
/** Ensure every known collection exists and (re)bind module store references.
 *  Called at startup and after a backup restore (store object is replaced). */
function initStoreCollections() {
  store.users ||= [];
  store.sessions ||= [];
  store.novaChats ||= {};
  store.adminAudit ||= [];
  store.institutions ||= []; store.departments ||= []; store.terms ||= [];
  store.enrollments ||= []; store.courseLessonProgress ||= {}; store.visionAssignments ||= []; store.resetTokens ||= [];
  store.courses ||= []; store.classes ||= []; store.assignments ||= []; store.notes ||= [];
  store.feedback ||= []; store.resources ||= []; store.notifications ||= [];
  store.userAttempts ||= {}; store.userProgress ||= {}; store.userVision ||= {};
  store.notificationReads ||= {}; store.teacherWorkspaces ||= {};
  store.idempotencyResults ||= {};
  store.quizzes ||= []; store.quizAttempts ||= []; store.questionBank ||= [];
  store.quizgenHistory ||= [];
  store.videoProgress ||= {}; store.certificates ||= [];
  store.plans ||= []; store.subscriptions ||= []; store.orders ||= [];
  store.studentCommunity ||= {posts:[],comments:[],follows:[],bookmarks:[],likes:[],reports:[]};
  for (const key of ['posts','comments','follows','bookmarks','likes','reports']) store.studentCommunity[key] ||= [];
  store.studentActivity ||= {}; store.courseReviews ||= []; store.lessonDiscussions ||= [];
  store.courseWishlists ||= {}; store.recentlyViewed ||= {}; store.studyPlans ||= {}; store.learningPathFollows ||= {};
  store.discussions ||= []; store.discussionReplies ||= []; store.liveSessions ||= []; store.classSessionRecords ||= [];
  store.studyGroups ||= []; store.groupNotes ||= []; store.groupMessages ||= [];
  store.userXp ||= {}; store.userBadges ||= {};
  store.campuses ||= []; store.academicYears ||= []; store.semesters ||= [];
  store.rolePermissions ||= org.defaultRolePermissions();
  org.init(store);
  org.migrateOrg();
  ops.init(store);
  store.feeStructures ||= []; store.feeRecords ||= [];
  store.subscriptionPlans ||= []; store.institutionSubscriptions ||= [];
  store.marketplaceListings ||= []; store.loginEvents ||= [];
  if (!store.plans.length) {
    const seedIso=new Date().toISOString();
    store.plans=[
      {id:'plan-free',name:'Free',priceCents:0,currency:'INR',interval:'one-time',features:['Browse the course catalog','Enroll in free courses','Community discussions'],active:true,createdAt:seedIso},
      {id:'plan-monthly',name:'Monthly',priceCents:49900,currency:'INR',interval:'monthly',features:['Access all paid courses','Certificates of completion','Join live classes'],active:true,createdAt:seedIso},
      {id:'plan-yearly',name:'Yearly',priceCents:499900,currency:'INR',interval:'yearly',features:['Access all paid courses','Certificates of completion','Join live classes','Priority support'],active:true,createdAt:seedIso},
    ];
  }
  store.settings ||= {};
  store.settings = {platformName:'EduVerse 3D',institution:'',timezone:'Asia/Kolkata',locale:'en-IN',defaultTheme:'system',maintenanceMessage:'',maxUploadMB:25,allowStudentRegistration:true,requireTeacherApproval:true,...store.settings};
  store.permissions ||= {};
  store.permissions.teacher ||= {canCreateCourses:true,canPublishCourses:true,canCreateAssignments:true,canGrade:true,canAssignVision:true,canViewAnalytics:true};
  store.permissions.student ||= {canEnrollCourses:true,canSubmitAssignments:true};
  store.permissions.admin ||= {canManageUsers:true,canManageCourses:true,canManageSettings:true,canViewReports:true};
  store.securityEvents ||= []; store.integrations ||= [];
  store.emailOutbox ||= []; store.errorLog ||= [];
  store.parentLinks ||= []; store.announcements ||= []; store.studentLinkCodes ||= [];
  family.init(store);
  store.libraryItems ||= []; store.bookLoans ||= []; store.readingLists ||= [];
  store.lessonDownloads ||= []; store.lessonPositions ||= {};
  library.init(store);
  store.calendarEvents ||= []; store.careerPaths ||= []; store.internships ||= [];
  store.aptitudeTests ||= []; store.aptitudeAttempts ||= []; store.mockInterviews ||= [];
  career.init(store);
  store.vocabSets ||= []; store.vocabAttempts ||= []; store.speakingExercises ||= []; store.speakingAttempts ||= [];
  lang.init(store);
  store.codeProjects ||= []; store.codeChallenges ||= []; store.codeAttempts ||= [];
  codelab.init(store);
  store.ltiConsumers ||= []; store.ltiLaunches ||= []; store.ltiNonces ||= [];
  store.scormPackages ||= []; store.xapiStatements ||= [];
  standards.init(store);
  store.refreshTokens ||= []; store.emailVerifications ||= [];
  jwt.init(store);
  sec.init(store);
  email.init(store); search.init(store); notify.init(store); monitor.init(store);
  search.rebuild();
}
initStoreCollections();
monitor.wrapProcess();
const sessions = new Map();
/** Deploy readiness (2026-11-11): sessions are mirrored into the JSON store
 *  as store.sessions[] ({id, userId, expiresAt}) so a restart no longer logs
 *  everyone out. The Map stays the hot path — the live module holds a
 *  reference to it, so it is never replaced. Session ids are never logged
 *  or returned; the store file itself is 0600 and git-ignored. */
const MAX_STORED_SESSIONS = 5000;
function pruneStoredSessions() {
  if (!Array.isArray(store.sessions)) store.sessions = [];
  const now = Date.now();
  store.sessions = store.sessions.filter(s => s && typeof s.id === 'string' && s.expiresAt > now);
  if (store.sessions.length > MAX_STORED_SESSIONS) {
    // Expired rows are already gone; drop the oldest remaining first.
    store.sessions.sort((a, b) => a.expiresAt - b.expiresAt);
    store.sessions = store.sessions.slice(store.sessions.length - MAX_STORED_SESSIONS);
  }
}
function storeSessionRow(sid, sess) {
  if (!Array.isArray(store.sessions)) store.sessions = [];
  const row = { id: sid, userId: sess.userId, expiresAt: sess.expiresAt };
  const idx = store.sessions.findIndex(s => s.id === sid);
  if (idx >= 0) store.sessions[idx] = row; else store.sessions.push(row);
  pruneStoredSessions();
}
function dropStoredSession(sid) {
  if (!Array.isArray(store.sessions)) return false;
  const before = store.sessions.length;
  store.sessions = store.sessions.filter(s => s.id !== sid);
  return store.sessions.length !== before;
}
function removeSession(sid) { sessions.delete(sid); return dropStoredSession(sid); }
function removeSessionsForUser(userId) {
  for (const [sid, sess] of sessions) if (sess.userId === userId) sessions.delete(sid);
  if (Array.isArray(store.sessions)) store.sessions = store.sessions.filter(s => s.userId !== userId);
}
/** Boot hydration: refill the Map from the store, dropping expired rows.
 *  Runs once at startup, after the store loads and before listening. */
function hydrateSessions() {
  if (!Array.isArray(store.sessions)) store.sessions = [];
  const now = Date.now();
  let pruned = false;
  for (const row of store.sessions) {
    if (row && typeof row.id === 'string' && typeof row.userId === 'string' && row.expiresAt > now) {
      sessions.set(row.id, { userId: row.userId, expiresAt: row.expiresAt });
    } else pruned = true;
  }
  pruneStoredSessions();
  if (pruned) persist().catch(() => {});
}
hydrateSessions();
const loginAttempts = new Map();
const ipLoginAttempts = new Map();
const signupAttempts = new Map();
const forgotAttempts = new Map();
const resetAttempts = new Map();
const changePasswordAttempts = new Map();
const mfaAttempts = new Map();
const verifyAttempts = new Map();
const chatAttempts = new Map();
const communityAttempts = new Map();
const activityAttempts = new Map();
const novaAttempts = new Map();
const groupMsgAttempts = new Map();
const setupAttempts = new Map();
const codeRunAttempts = new Map();
function consumeRate(map, key, limit, windowMs) { const now=Date.now(), old=map.get(key)||[]; const recent=old.filter(t=>now-t<windowMs); if(recent.length>=limit) return false; recent.push(now); map.set(key, recent); return true; }
function peekRate(map, key, windowMs) { const now=Date.now(), old=map.get(key)||[]; return old.filter(t=>now-t<windowMs).length; }
function clientIp(req) { return req.socket.remoteAddress || 'local'; }
/** POST a ping payload to a webhook URL (5s timeout). Never throws. */
function pingWebhook(target) {
  return new Promise((resolve) => {
    let done = false;
    const finish = (r) => { if (!done) { done = true; resolve(r); } };
    let req;
    try {
      const lib = String(target).startsWith('https:') ? https : http;
      const payload = JSON.stringify({ type: 'eduverse.ping', at: new Date().toISOString() });
      const started = Date.now();
      const timer = setTimeout(() => { finish({ ok: false, error: 'timed out after 5s' }); try { req.destroy(); } catch {} }, 5000);
      req = lib.request(target, { method: 'POST', headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload), 'User-Agent': 'EduVerse-integration-test' } }, (res) => {
        res.resume();
        res.on('end', () => { clearTimeout(timer); finish({ ok: res.statusCode >= 200 && res.statusCode < 300, status: res.statusCode, ms: Date.now() - started }); });
      });
      req.on('error', (e) => { clearTimeout(timer); finish({ ok: false, error: String(e.message || e).slice(0, 200) }); });
      req.end(payload);
    } catch (e) { finish({ ok: false, error: String(e.message || e).slice(0, 200) }); }
  });
}
const SESSION_MS = 12 * 60 * 60 * 1000;
/** Code-runner kill switch (deploy readiness): CODE_EXEC_ENABLED=false disables
 *  all code execution — /api/code/run 503s and exam code questions grade 0.
 *  Default (unset / anything else): enabled, current behaviour preserved. */
const CODE_EXEC_DISABLED = String(process.env.CODE_EXEC_ENABLED || '').trim().toLowerCase() === 'false';
const CODE_EXEC_DISABLED_MESSAGE = 'Code execution is disabled on this server.';
const OPENCV_DIR = path.join(PROJECT_ROOT, 'opencv-drawing');
let openCvProcess = null;
let stopping = false;
function persist() {
  const snapshot = JSON.stringify(store, null, 2);
  writeQueue = writeQueue.catch(() => {}).then(async () => {
    const tempPath = `${STORE_PATH}.${process.pid}.${randomUUID()}.tmp`;
    let handle;
    try {
      handle = await fs.promises.open(tempPath, 'wx', 0o600);
      await handle.writeFile(snapshot, 'utf8');
      await handle.sync();
      await handle.close();
      handle = null;
      try {
        const previous = await fs.promises.readFile(STORE_PATH);
        const backupPath = `${STORE_PATH}.bak`;
        const backupTempPath = `${backupPath}.${process.pid}.${randomUUID()}.tmp`;
        let backupHandle;
        try {
          backupHandle = await fs.promises.open(backupTempPath, 'wx', 0o600);
          await backupHandle.writeFile(previous);
          await backupHandle.sync();
          await backupHandle.close();
          backupHandle = null;
          await fs.promises.rename(backupTempPath, backupPath);
          await fs.promises.chmod(backupPath, 0o600);
        } catch (error) {
          if (backupHandle) await backupHandle.close().catch(() => {});
          await fs.promises.unlink(backupTempPath).catch(() => {});
          throw error;
        }
      } catch (error) {
        if (error.code !== 'ENOENT') throw error;
      }
      await fs.promises.rename(tempPath, STORE_PATH);
      await fs.promises.chmod(STORE_PATH, 0o600);
      try {
        const directory = await fs.promises.open(path.dirname(STORE_PATH), 'r');
        try { await directory.sync(); } finally { await directory.close(); }
      } catch (error) {
        if (!['EINVAL', 'ENOTSUP', 'EISDIR', 'EPERM'].includes(error.code)) throw error;
      }
    } catch (error) {
      if (handle) await handle.close().catch(() => {});
      await fs.promises.unlink(tempPath).catch(() => {});
      throw error;
    }
  });
  return writeQueue;
}
const executeIdempotent = createIdempotencyExecutor({ store, persist });
function send(res, status, payload) {
  const headers={'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff','X-Frame-Options':'DENY','Referrer-Policy':'no-referrer','Permissions-Policy':'camera=(self), microphone=(), geolocation=()','Content-Security-Policy':"default-src 'self'; img-src 'self' https: data:; style-src 'self' https://fonts.googleapis.com 'unsafe-inline'; font-src 'self' https://fonts.gstatic.com; script-src 'self'; connect-src 'self' http://127.0.0.1:4174; frame-src 'self' blob:; frame-ancestors 'none'; base-uri 'self'; form-action 'self'"};
  if(process.env.NODE_ENV==='production') headers['Strict-Transport-Security']='max-age=31536000; includeSubDomains';
  res.writeHead(status, headers);
  res.end(JSON.stringify(payload));
}
function parseCookies(header='') { const out={}; for(const part of String(header||'').split(';')){ const index=part.indexOf('='); if(index<0) continue; try{ out[decodeURIComponent(part.slice(0,index).trim())]=decodeURIComponent(part.slice(index+1).trim()); }catch{} } return out; }
function cookieOptions(maxAge=SESSION_MS/1000) { return `Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${process.env.NODE_ENV==='production'?'; Secure':''}`; }
function setSessionCookie(res,id) { res.setHeader('Set-Cookie',`eduverse_session=${encodeURIComponent(id)}; ${cookieOptions()}`); }
function clearSessionCookie(res) { res.setHeader('Set-Cookie',`eduverse_session=; ${cookieOptions(0)}`); }
async function passwordHash(password,salt=randomBytes(16).toString('hex')) { const derived=await scrypt(password,salt,64); return `scrypt:${salt}:${derived.toString('hex')}`; }
async function passwordMatches(password,encoded) { try { const [,salt,hex]=encoded.split(':'); const expected=Buffer.from(hex,'hex'),actual=await scrypt(password,salt,expected.length); return expected.length===actual.length&&timingSafeEqual(expected,actual); } catch { return false; } }
function publicUser(user) { return {id:user.id,name:user.name,username:user.username||'',email:user.email||'',phone:user.phone||'',age:user.age??null,institution:user.institution||'',registrationNumber:user.registrationNumber||'',rollNumber:user.rollNumber||'',grade:user.grade||'',section:user.section||'',role:user.role,status:user.status,emailVerified:!!user.emailVerified,institutionId:user.institutionId||null,campusId:user.campusId||null,departmentId:user.departmentId||null,createdAt:user.createdAt}; }
function publicProfile(user) { return {id:user.id,accountId:user.id,name:user.name,username:user.username||'',email:user.email||'',phone:user.phone||'',bio:user.bio||'',role:user.role,age:user.age??null,institution:user.institution||'',joinedAt:user.createdAt,dailyGoalMinutes:store.profile?.dailyGoalMinutes??30,preferences:user.preferences||{theme:'system'}}; }
function audit(actor,action,target) { store.adminAudit.unshift({id:randomUUID(),actor:actor.id,action,target,at:new Date().toISOString()}); store.adminAudit=store.adminAudit.slice(0,300); }
function sendText(res, status, text, type='text/csv; charset=utf-8') { res.writeHead(status, {'Content-Type':type,'Content-Disposition':'attachment','Cache-Control':'no-store','X-Content-Type-Options':'nosniff','X-Frame-Options':'DENY','Referrer-Policy':'no-referrer','Permissions-Policy':'camera=(self), microphone=(), geolocation=()','Content-Security-Policy':"default-src 'none'; frame-ancestors 'none'"}); res.end(text); }
function publicSettings() { const st=store.settings||{}; return {platformName:st.platformName||'EduVerse 3D',institution:st.institution||'',timezone:st.timezone||'Asia/Kolkata',locale:st.locale||'en-IN',defaultTheme:st.defaultTheme||'system',maintenanceMessage:st.maintenanceMessage||'',maxUploadMB:st.maxUploadMB||25,allowStudentRegistration:st.allowStudentRegistration!==false,requireTeacherApproval:st.requireTeacherApproval!==false}; }
function hasPerm(role, perm) { const set=(store.permissions||{})[role]||{}; return set[perm]!==false; }
function base32Encode(buf) { const alphabet='ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'; let out='',bits=0,value=0; for (const byte of buf) { value=(value<<8)|byte; bits+=8; while (bits>=5) { bits-=5; out+=alphabet[(value>>bits)&31]; } } if (bits>0) out+=alphabet[(value<<(5-bits))&31]; return out; }
function base32Decode(text) { const alphabet='ABCDEFGHIJKLMNOPQRSTUVWXYZ234567',clean=String(text).replace(/=+$/,'').toUpperCase(); let bits=0,value=0,out=[]; for (const ch of clean) { const idx=alphabet.indexOf(ch); if (idx<0) continue; value=(value<<5)|idx; bits+=5; if (bits>=8) { bits-=8; out.push((value>>bits)&255); } } return Buffer.from(out); }
function totpCode(secret, counter) { const buf=Buffer.alloc(8); buf.writeBigUInt64BE(BigInt(counter)); const h=createHmac('sha1', base32Decode(secret)).update(buf).digest(); const off=h[h.length-1]&15; const code=((h[off]&127)<<24)|((h[off+1]&255)<<16)|((h[off+2]&255)<<8)|(h[off+3]&255); return String(code%1000000).padStart(6,'0'); }
function totpValid(secret, code) { if (!secret || !/^\d{6}$/.test(String(code||''))) return false; const now=Math.floor(Date.now()/30000); return [-1,0,1].some(d=>totpCode(secret, now+d)===String(code)); }
function emptyProgress() { return {streakDays:0,weeklyMinutes:0,completedChallenges:0,concepts:{'sorted-arrays':{mastery:0,evidenceCount:0},'search-boundaries':{mastery:0,evidenceCount:0},'time-complexity':{mastery:0,evidenceCount:0}}}; }
function progressForUser(id) { store.userProgress ||= {};return store.userProgress[id] ||= emptyProgress(); }
function studentDay(date=new Date()) { return new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Kolkata',year:'numeric',month:'2-digit',day:'2-digit'}).format(date); }
function recordStudentActivity(id, kind='learning') { store.studentActivity ||= {};const state=store.studentActivity[id] ||= {days:[],recent:[]};const today=studentDay();if(!state.days.includes(today)){state.days.push(today);state.days=state.days.slice(-400);}state.recent.unshift({kind,at:new Date().toISOString()});state.recent=state.recent.slice(0,100);const days=new Set(state.days),parts=today.split('-').map(Number),cursor=new Date(Date.UTC(parts[0],parts[1]-1,parts[2]));let streak=0;while(days.has(studentDay(cursor))){streak++;cursor.setUTCDate(cursor.getUTCDate()-1);}const progress=progressForUser(id);progress.streakDays=streak;return streak; }
function createNotification(userId,type,title,message,entityId=null){if(!userId)return null;store.notifications||=[];const item={id:randomUUID(),userId,type,title,message,entityId,createdAt:new Date().toISOString()};store.notifications.unshift(item);return item;}
function notifyClassStudents(classItem,type,title,message,entityId=null){for(const id of classItem?.studentIds||[])createNotification(id,type,title,message,entityId);}
function createReminderOnce(userId,key,type,title,message){store.notifications||=[];if(store.notifications.some(n=>n.userId===userId&&n.reminderKey===key))return;const item=createNotification(userId,type,title,message);item.reminderKey=key;}
function ensureStudentReminders(userId){const before=(store.notifications||[]).length,now=Date.now(),classes=(store.classes||[]).filter(c=>c.studentIds?.includes(userId)),classIds=new Set(classes.map(c=>c.id));for(const assignment of store.assignments||[]){if(!assignment.studentIds?.includes(userId)||assignment.submissions?.[userId]||!/^\d{4}-\d{2}-\d{2}$/.test(String(assignment.dueDate||'')))continue;const due=Date.parse(`${assignment.dueDate}T23:59:59+05:30`);if(due>=now&&due-now<=24*60*60*1000)createReminderOnce(userId,`assignment:${assignment.id}`, 'assignment-reminder','Assignment due soon',`${assignment.title} is due ${assignment.dueDate}.`);}for(const teacherId of Object.keys(store.teacherWorkspaces||{})){for(const session of store.teacherWorkspaces[teacherId].schedule||[]){if(!classIds.has(session.classId)||!/^\d{4}-\d{2}-\d{2}$/.test(String(session.date||'')))continue;const time=/^\d{2}:\d{2}$/.test(String(session.time||''))?session.time:'09:00',starts=Date.parse(`${session.date}T${time}:00+05:30`);if(starts>=now&&starts-now<=24*60*60*1000)createReminderOnce(userId,`session:${session.id}`,'live-class-reminder','Live class reminder',`${session.title||'Your class'} starts ${session.date} at ${time}.`);}}return (store.notifications||[]).length>before;}
function visionForUser(id) { store.userVision ||= {};return store.userVision[id] ||= {events:[],completed:{},badges:[],experiments:{},xp:0}; }
function teacherWorkspaceFor(id) { store.teacherWorkspaces ||= {};return store.teacherWorkspaces[id] ||= {schedule:[],attendance:[],practice:[],tests:[]}; }
const BADGES=[
  {id:'first-steps',name:'First Steps',description:'Completed your first lesson.'},
  {id:'week-warrior',name:'Week Warrior',description:'Kept a 7-day learning streak.'},
  {id:'quiz-master',name:'Quiz Master',description:'Scored 90 or higher on a quiz.'},
  {id:'scholar',name:'Scholar',description:'Earned 1,000 XP.'},
  {id:'helper',name:'Helper',description:'Posted 5 discussion replies.'},
  {id:'graduate',name:'Graduate',description:'Earned your first certificate.'},
];
function xpForUser(userId){store.userXp ||= {};return store.userXp[userId] ||= {xp:0,level:1,streakDays:0,lastActiveDate:''};}
function badgeListFor(userId){store.userBadges ||= {};return store.userBadges[userId] ||= [];}
function awardBadge(userId,badgeId){const list=badgeListFor(userId);if(list.some(b=>b.badgeId===badgeId))return false;list.push({badgeId,awardedAt:new Date().toISOString()});return true;}
function xpLevelFor(xp){return Math.floor(Math.sqrt(Math.max(0,Number(xp)||0)/100))+1;}
function awardXp(userId,n,reason){const amt=Math.max(0,Math.floor(Number(n)||0));if(!userId||amt<=0)return null;const rec=xpForUser(userId),today=new Date().toISOString().slice(0,10);
  if(rec.lastActiveDate&&rec.lastActiveDate!==today){const yesterday=new Date(Date.now()-86400000).toISOString().slice(0,10);rec.streakDays=rec.lastActiveDate===yesterday?(rec.streakDays||0)+1:1;}
  else if(!rec.lastActiveDate)rec.streakDays=1;
  rec.lastActiveDate=today;rec.xp=(rec.xp||0)+amt;rec.level=xpLevelFor(rec.xp);
  if(rec.xp>=1000)awardBadge(userId,'scholar');
  if((rec.streakDays||0)>=7)awardBadge(userId,'week-warrior');
  return rec;}
function shuffle(arr){const a=[...arr];for(let i=a.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1));const t=a[i];a[i]=a[j];a[j]=t;}return a;}
const EXAM_QUESTION_TYPES=['mcq','truefalse','short','multiselect','fillblank','match','essay','code'];
const EXAM_DIFFICULTIES=['easy','medium','hard'];
function validateExamRubric(rubric){
  if(rubric===undefined||rubric===null||rubric==='')return {ok:true,value:[]};
  if(!Array.isArray(rubric))return {ok:false,error:'Rubric must be a list of criteria.'};
  if(rubric.length>10)return {ok:false,error:'A rubric can have at most 10 criteria.'};
  const out=[];
  for(const r of rubric){const criterion=String((r&&r.criterion)||'').trim();const maxPoints=Number(r&&r.maxPoints);
    if(criterion.length<2||criterion.length>120)return {ok:false,error:'Rubric criteria need 2 to 120 characters.'};
    if(!Number.isInteger(maxPoints)||maxPoints<1||maxPoints>100)return {ok:false,error:'Rubric points must be 1 to 100.'};
    out.push({id:(r&&r.id)||randomUUID(),criterion,maxPoints});}
  return {ok:true,value:out};
}
function validateExamQuestion(q,i){
  const label=`Question ${i+1}`;
  if(!EXAM_QUESTION_TYPES.includes(q.type))return `${label}: choose one of ${EXAM_QUESTION_TYPES.join(', ')}.`;
  const prompt=String(q.prompt||'').trim();
  if(prompt.length<2||prompt.length>2000)return `${label}: write a prompt of 2 to 2,000 characters.`;
  const points=q.points===undefined?1:Number(q.points);
  if(!Number.isInteger(points)||points<1||points>100)return `${label}: points must be 1 to 100.`;
  if(q.explanation!==undefined&&String(q.explanation).length>2000)return `${label}: explanation must be 2,000 characters or fewer.`;
  if(q.difficulty!==undefined&&q.difficulty!==''&&!EXAM_DIFFICULTIES.includes(q.difficulty))return `${label}: difficulty must be easy, medium, or hard.`;
  if(q.topic!==undefined&&String(q.topic).length>80)return `${label}: topic must be 80 characters or fewer.`;
  if(q.type==='mcq'){const options=Array.isArray(q.options)?q.options.map(o=>String(o).trim()).filter(Boolean):[];
    if(options.length<2||options.length>10)return `${label}: add 2 to 10 options.`;
    if(!Number.isInteger(q.correctIndex)||q.correctIndex<0||q.correctIndex>=options.length)return `${label}: mark the correct option.`;}
  if(q.type==='truefalse'&&typeof q.correctBoolean!=='boolean')return `${label}: set the correct true/false answer.`;
  if(q.type==='short'){const accepted=Array.isArray(q.acceptedAnswers)?q.acceptedAnswers:[];if(accepted.length>20)return `${label}: list at most 20 accepted answers.`;}
  if(q.type==='multiselect'){const options=Array.isArray(q.options)?q.options.map(o=>String(o).trim()).filter(Boolean):[];
    if(options.length<2||options.length>10)return `${label}: add 2 to 10 options.`;
    const ci=Array.isArray(q.correctIndices)?[...new Set(q.correctIndices)]:[];
    if(!ci.length||ci.some(x=>!Number.isInteger(x)||x<0||x>=options.length))return `${label}: mark at least one valid correct option.`;}
  if(q.type==='fillblank'){const template=String(q.template||'');
    const blanks=(template.match(/___/g)||[]).length;
    if(blanks<1||blanks>8)return `${label}: template needs 1 to 8 blanks written as ___.`;
    const ba=Array.isArray(q.blankAnswers)?q.blankAnswers:[];
    if(ba.length!==blanks)return `${label}: give accepted answers for each of the ${blanks} blanks.`;
    for(const list of ba){const arr=Array.isArray(list)?list:[];
      if(!arr.length||arr.length>10||arr.some(a=>String(a).trim().length<1||String(a).length>200))return `${label}: each blank needs 1 to 10 accepted answers (up to 200 characters).`;}}
  if(q.type==='match'){const pairs=Array.isArray(q.pairs)?q.pairs:[];
    if(pairs.length<2||pairs.length>8)return `${label}: add 2 to 8 pairs to match.`;
    const lefts=new Set();
    for(const p of pairs){const l=String(p&&p.left||'').trim(),r=String(p&&p.right||'').trim();
      if(l.length<1||l.length>200||r.length<1||r.length>200)return `${label}: each pair needs text of 1 to 200 characters.`;
      if(lefts.has(l.toLowerCase()))return `${label}: left-side items must be unique.`;
      lefts.add(l.toLowerCase());}}
  if(q.type==='essay'){const mw=q.maxWords===undefined?0:Number(q.maxWords);
    if(!Number.isInteger(mw)||mw<0||mw>5000)return `${label}: max words must be 0 to 5,000.`;
    const rc=validateExamRubric(q.rubric);if(!rc.ok)return `${label}: ${rc.error}`;}
  if(q.type==='code'){const lang=String(q.language||'javascript').trim().toLowerCase();
    if(lang.length>20)return `${label}: language name is too long.`;
    if(String(q.starterCode||'').length>10000)return `${label}: starter code must be 10,000 characters or fewer.`;
    const tcs=Array.isArray(q.testCases)?q.testCases:[];
    if(!tcs.length||tcs.length>20)return `${label}: add 1 to 20 test cases.`;
    for(const tc of tcs){if(String(tc&&tc.input||'').length>2000||String(tc&&tc.expectedOutput||'').length>2000)return `${label}: test case input/output must be 2,000 characters or fewer.`;
      const p=Number(tc&&tc.points);if(!Number.isInteger(p)||p<1||p>100)return `${label}: test case points must be 1 to 100.`;}}
  return null;
}
/** Validate advanced exam config on quiz create/PATCH. Returns {ok, error?, config}. */
function validateQuizConfig(body){
  const config={};
  if(body.negativeMarking!==undefined){const n=Number(body.negativeMarking);if(!Number.isFinite(n)||n<0||n>1)return {ok:false,error:'Negative marking must be between 0 and 1.'};config.negativeMarking=n;}
  if(body.showSolutions!==undefined){if(!['immediate','after_pass','never'].includes(body.showSolutions))return {ok:false,error:'showSolutions must be immediate, after_pass, or never.'};config.showSolutions=body.showSolutions;}
  if(body.adaptive!==undefined)config.adaptive=body.adaptive===true;
  if(body.difficultyMix!==undefined){const dm=body.difficultyMix||{},mix={};
    for(const d of EXAM_DIFFICULTIES){const n=dm[d]===undefined?0:Math.floor(Number(dm[d]));if(!Number.isInteger(n)||n<0||n>100)return {ok:false,error:'difficultyMix counts must be 0 to 100.'};mix[d]=n;}
    config.difficultyMix=mix;}
  if(body.randomSelect!==undefined){const rs=body.randomSelect;
    if(rs===null){config.randomSelect=null;}
    else if(typeof rs==='object'){const count=Math.floor(Number(rs.count));
      if(!Number.isInteger(count)||count<1||count>100)return {ok:false,error:'randomSelect.count must be 1 to 100.'};
      const out={count};
      if(rs.difficulty!==undefined){if(!EXAM_DIFFICULTIES.includes(rs.difficulty))return {ok:false,error:'randomSelect.difficulty must be easy, medium, or hard.'};out.difficulty=rs.difficulty;}
      if(rs.topic!==undefined&&String(rs.topic).trim())out.topic=String(rs.topic).trim().slice(0,80);
      config.randomSelect=out;}
    else return {ok:false,error:'randomSelect must be an object or null.'};}
  if(body.proctoring!==undefined){const p=body.proctoring||{};config.proctoring={enabled:p.enabled===true,snapshotIntervalSec:Math.max(10,Math.min(300,Math.floor(Number(p.snapshotIntervalSec)||60)))};}
  if(body.antiCheat!==undefined){const a=body.antiCheat||{};config.antiCheat={detectTabSwitch:a.detectTabSwitch===true,disableCopy:a.disableCopy===true};}
  return {ok:true,config};
}
/** Copy owned question-bank entries into fresh question objects (new ids). */
function copyBankQuestions(ids, auth){
  const out=[];
  for(const id of (Array.isArray(ids)?ids:[]).slice(0,100)){
    const b=(store.questionBank||[]).find(x=>x.id===String(id));
    if(!b||(b.ownerId!==auth.id&&auth.role!=='admin'))return {ok:false,error:'Question bank entry not found or not yours.'};
    const {id:bid,ownerId,createdAt,updatedAt,...fields}=b;
    out.push(fields);
  }
  return {ok:true,questions:out};
}
function defaultQuizConfig(){return {negativeMarking:0,showSolutions:'after_pass',adaptive:false,difficultyMix:null,randomSelect:null,proctoring:{enabled:false,snapshotIntervalSec:60},antiCheat:{detectTabSwitch:false,disableCopy:false}};}
function validateQuizQuestions(questions){
  if(!Array.isArray(questions)||!questions.length)return 'Add at least one question.';
  if(questions.length>100)return 'A quiz can have at most 100 questions.';
  for(let i=0;i<questions.length;i++){const err=validateExamQuestion(questions[i]||{},i);if(err)return err;}
  return null;
}
function normalizeQuestion(q){const base={id:randomUUID(),type:q.type,prompt:String(q.prompt).trim(),points:q.points===undefined?1:Number(q.points),
  explanation:String(q.explanation||'').slice(0,2000),
  difficulty:EXAM_DIFFICULTIES.includes(q.difficulty)?q.difficulty:'medium',
  topic:String(q.topic||'').trim().slice(0,80)};
  if(q.type==='mcq'){base.options=q.options.map(o=>String(o).trim()).filter(Boolean);base.correctIndex=q.correctIndex;}
  if(q.type==='truefalse')base.correctBoolean=q.correctBoolean;
  if(q.type==='short')base.acceptedAnswers=(Array.isArray(q.acceptedAnswers)?q.acceptedAnswers:[]).map(a=>String(a).trim()).filter(Boolean).slice(0,20);
  if(q.type==='multiselect'){base.options=q.options.map(o=>String(o).trim()).filter(Boolean);base.correctIndices=[...new Set(q.correctIndices)];}
  if(q.type==='fillblank'){base.template=String(q.template||'');base.blankAnswers=q.blankAnswers.map(list=>(Array.isArray(list)?list:[]).map(a=>String(a).trim()).filter(Boolean).slice(0,10));}
  if(q.type==='match'){base.pairs=q.pairs.map(p=>({left:String(p.left).trim(),right:String(p.right).trim()}));}
  if(q.type==='essay'){base.maxWords=Math.max(0,Math.min(5000,Math.floor(Number(q.maxWords)||0)));const rc=validateExamRubric(q.rubric);base.rubric=rc.ok?rc.value:[];}
  if(q.type==='code'){base.language=String(q.language||'javascript').trim().toLowerCase().slice(0,20)||'javascript';base.starterCode=String(q.starterCode||'').slice(0,10000);
    base.testCases=q.testCases.map(tc=>({input:String(tc.input||'').slice(0,2000),expectedOutput:String(tc.expectedOutput||'').slice(0,2000),points:Math.max(1,Math.min(100,Math.floor(Number(tc.points)||1)))}));}
  return base;}
function publicQuestion(q){const out={id:q.id,type:q.type,prompt:q.prompt,points:q.points,
  difficulty:q.difficulty||'medium',topic:q.topic||''};
  if(Array.isArray(q.options))out.options=[...q.options];
  if(q.type==='fillblank')out.template=q.template;
  if(q.type==='match'){out.lefts=q.pairs.map(p=>p.left);out.rights=shuffle(q.pairs.map(p=>p.right));}
  if(q.type==='essay'){out.maxWords=q.maxWords||0;if(Array.isArray(q.rubric)&&q.rubric.length)out.rubric=q.rubric.map(r=>({id:r.id,criterion:r.criterion,maxPoints:r.maxPoints}));}
  if(q.type==='code'){out.language=q.language||'javascript';out.starterCode=q.starterCode||'';out.testCases=(q.testCases||[]).map(tc=>({input:tc.input,points:tc.points}));}
  return out;}
function stripQuizForStudent(quiz){return {id:quiz.id,courseId:quiz.courseId||null,title:quiz.title,description:quiz.description,timeLimitMin:quiz.timeLimitMin||0,maxAttempts:quiz.maxAttempts||0,shuffleQuestions:!!quiz.shuffleQuestions,shuffleOptions:!!quiz.shuffleOptions,passingScore:quiz.passingScore??50,status:quiz.status,isFinalAssessment:!!quiz.isFinalAssessment,
  negativeMarking:Number(quiz.negativeMarking)||0,showSolutions:['immediate','after_pass','never'].includes(quiz.showSolutions)?quiz.showSolutions:'after_pass',adaptive:!!quiz.adaptive,
  proctoring:{enabled:!!(quiz.proctoring&&quiz.proctoring.enabled),snapshotIntervalSec:Math.max(10,Math.min(300,Number(quiz.proctoring&&quiz.proctoring.snapshotIntervalSec)||60))},
  antiCheat:{detectTabSwitch:!!(quiz.antiCheat&&quiz.antiCheat.detectTabSwitch),disableCopy:!!(quiz.antiCheat&&quiz.antiCheat.disableCopy)},
  questionCount:(quiz.questions||[]).length,questions:(quiz.questions||[]).map(publicQuestion),createdAt:quiz.createdAt,updatedAt:quiz.updatedAt};}
function attemptDisplayQuestions(quiz,attempt){const qs=attempt&&Array.isArray(attempt.questionSnapshot)&&attempt.questionSnapshot.length?attempt.questionSnapshot:(quiz.questions||[]);const byId=new Map(qs.map(q=>[q.id,q]));const order=Array.isArray(attempt.questionOrder)&&attempt.questionOrder.length?attempt.questionOrder:qs.map(q=>q.id);
  return order.map(qid=>{const q=byId.get(qid);if(!q)return null;const out=publicQuestion(q);const oo=attempt.optionOrder&&attempt.optionOrder[qid];if(Array.isArray(oo)&&out.options)out.options=oo.map(i=>out.options[i]);return out;}).filter(Boolean);}
function stripAttemptForStudent(a){const copy={...a};delete copy.passXpAwarded;delete copy.questionSnapshot;
  if(copy.questionGrades&&typeof copy.questionGrades==='object'){const qg={};
    for(const [k,g] of Object.entries(copy.questionGrades)){qg[k]=Object.assign({},g);
      if(g&&Array.isArray(g.codeResults))qg[k].codeResults=g.codeResults.map(({expectedOutput,...rest})=>rest);}
    copy.questionGrades=qg;}
  return copy;}
function gradeObjective(question,answer,optionOrder){
  if(question.type==='mcq'){const idx=Number(answer);if(!Number.isInteger(idx))return 0;const order=Array.isArray(optionOrder)?optionOrder:null;
    if(order&&(idx<0||idx>=order.length))return 0;const original=order?order[idx]:idx;
    return original===question.correctIndex?question.points:0;}
  if(question.type==='truefalse'){const v=answer===true||answer==='true'||answer===1||answer==='1';return v===question.correctBoolean?question.points:0;}
  if(question.type==='multiselect'){const order=Array.isArray(optionOrder)?optionOrder:null;
    const picked=[...new Set((Array.isArray(answer)?answer:[]).filter(x=>Number.isInteger(x)))];
    const original=picked.map(i=>order?order[i]:i).filter(i=>Number.isInteger(i)&&i>=0&&i<(question.options||[]).length);
    const correctSet=new Set(question.correctIndices||[]);let cp=0,wp=0;
    for(const i of new Set(original)){if(correctSet.has(i))cp++;else wp++;}
    const total=correctSet.size;if(!total)return 0;
    return Math.max(0,question.points*(cp-wp)/total);}
  if(question.type==='fillblank'){const blanks=(String(question.template||'').match(/___/g)||[]).length;
    const given=Array.isArray(answer)?answer:[];let correct=0;
    for(let i=0;i<blanks;i++){const g=String(given[i]||'').trim().toLowerCase();
      const accepted=((question.blankAnswers||[])[i]||[]).map(a=>String(a).trim().toLowerCase());
      if(g&&accepted.includes(g))correct++;}
    return blanks?question.points*correct/blanks:0;}
  if(question.type==='match'){const pairs=question.pairs||[];const given=Array.isArray(answer)?answer:[];let correct=0;
    for(let i=0;i<pairs.length;i++){if(String(given[i]||'').trim().toLowerCase()===String(pairs[i].right).trim().toLowerCase())correct++;}
    return pairs.length?question.points*correct/pairs.length:0;}
  return 0;
}
/** Whether the student actually attempted an objective question (for negative marking). */
function isObjectiveAttempted(question,answer){
  if(answer===null||answer===undefined)return false;
  if(question.type==='mcq')return Number.isInteger(Number(answer));
  if(question.type==='truefalse')return answer===true||answer==='true'||answer===1||answer==='1'||answer===false||answer==='false'||answer===0||answer==='0';
  if(question.type==='multiselect')return Array.isArray(answer)&&answer.length>0;
  if(question.type==='fillblank'||question.type==='match')return Array.isArray(answer)&&answer.some(a=>String(a||'').trim().length>0);
  if(question.type==='code')return String(answer||'').trim().length>0;
  return false;
}
const EXAM_OBJECTIVE_TYPES=['mcq','truefalse','multiselect','fillblank','match','code'];
/** Sanitize a raw submitted answer according to question type. */
function sanitizeExamAnswer(q,v){
  switch(q.type){
    case 'mcq':{const n=Number(v);return Number.isInteger(n)?n:null;}
    case 'truefalse':return (v===true||v==='true'||v===1||v==='1')?true:(v===false||v==='false'||v===0||v==='0')?false:null;
    case 'multiselect':return Array.isArray(v)?[...new Set(v.map(Number).filter(x=>Number.isInteger(x)))].slice(0,10):[];
    case 'fillblank':return Array.isArray(v)?v.slice(0,8).map(x=>String(x).slice(0,500)):[];
    case 'match':return Array.isArray(v)?v.slice(0,8).map(x=>String(x).slice(0,200)):[];
    case 'essay':return String(v||'').slice(0,20000);
    case 'code':return String(v||'').slice(0,20000);
    default:return typeof v==='string'?v.slice(0,5000):(typeof v==='number'||typeof v==='boolean'?v:null);
  }
}
function activeSubscription(userId){const now=Date.now();return (store.subscriptions||[]).find(s=>s.userId===userId&&['active','cancelled'].includes(s.status)&&(!s.endsAt||new Date(s.endsAt).getTime()>now))||null;}
function hasCourseAccess(userId,courseId){
  if((store.orders||[]).some(o=>o.userId===userId&&o.kind==='course'&&o.refId===courseId&&o.status==='paid'))return true;
  const sub=activeSubscription(userId);if(!sub)return false;
  const plan=(store.plans||[]).find(p=>p.id===sub.planId);
  return !!plan&&Number(plan.priceCents||0)>0;
}
function courseAllLessons(course){return (course.modules||[]).flatMap(m=>m.lessons||[]);}
function certificateEligibility(userId,courseId){
  const course=(store.courses||[]).find(c=>c.id===courseId);
  if(!course)return {eligible:false,missing:['Course not found.'],course:null,quizzes:[]};
  const missing=[];
  if(!(store.enrollments||[]).some(e=>e.studentId===userId&&e.courseId===courseId))missing.push('Enroll in this course first.');
  const lessons=courseAllLessons(course),done=new Set(store.courseLessonProgress[`${userId}:${courseId}`]||[]);
  const incomplete=lessons.filter(l=>!done.has(l.id)).length;
  if(incomplete)missing.push(`${incomplete} lesson${incomplete===1?'':'s'} still incomplete.`);
  const quizzes=(store.quizzes||[]).filter(q=>q.courseId===courseId&&q.status==='published');
  for(const q of quizzes){const passed=(store.quizAttempts||[]).some(a=>a.quizId===q.id&&a.studentId===userId&&a.passed);if(!passed)missing.push(`Pass the quiz "${q.title}".`);}
  return {eligible:missing.length===0,missing,course,quizzes};
}
function validateVideoUrl(value){const v=String(value||'').trim();if(!v)return {ok:true,value:''};
  if(v.length>2000)return {ok:false,error:'Video URL must be 2,000 characters or fewer.'};
  if(!/^https?:\/\//i.test(v))return {ok:false,error:'Video URL must start with http(s)://.'};
  return {ok:true,value:v};}
function detectVideoType(url){return /youtube\.com|youtu\.be/i.test(String(url||''))?'youtube':'mp4';}
const LESSON_KINDS=['video','reading','interactive','pdf','coding','quiz','assignment'];
function validateLessonKind(v){const k=String(v||'').trim().toLowerCase();if(!k)return {ok:true,value:''};if(!LESSON_KINDS.includes(k))return {ok:false,error:'Lesson kind must be one of: '+LESSON_KINDS.join(', ')+'.'};return {ok:true,value:k};}
function validateVideoSources(v){
  if(v===undefined||v===null||v==='')return {ok:true,value:[]};
  const arr=Array.isArray(v)?v:String(v).split('\n');
  const out=[];
  for(const item of arr.slice(0,4)){
    let label,src;
    if(typeof item==='string'){const p=item.split('|');if(p.length===2){label=p[0].trim();src=p[1].trim();}else{src=item.trim();label='';}}
    else{label=String(item.label||'').trim().slice(0,24);src=String(item.src||'').trim();}
    if(!src)continue;
    const c=validateVideoUrl(src);if(!c.ok)return {ok:false,error:'Video source "'+(label||src).slice(0,40)+'": '+c.error};
    if(detectVideoType(c.value)!=='mp4')return {ok:false,error:'Quality variants must be direct mp4 URLs (YouTube handles its own quality).'};
    out.push({label:label||`${out.length+1}`,src:c.value});
  }
  return {ok:true,value:out};
}
function validateCaptions(v){
  if(v===undefined||v===null||v==='')return {ok:true,value:[]};
  const arr=Array.isArray(v)?v:String(v).split('\n');
  const out=[];
  for(const item of arr.slice(0,4)){
    let label,srclang,src;
    if(typeof item==='string'){const p=item.split('|').map(s=>s.trim());if(p.length<2)return {ok:false,error:'Caption line must look like "English|en|https://…/subs.vtt".'};src=p.pop();srclang=(p[1]||p[0]||'en').toLowerCase().slice(0,8);label=(p[0]||srclang).slice(0,40);}
    else{label=String(item.label||'').trim().slice(0,40);srclang=String(item.srclang||'en').trim().toLowerCase().slice(0,8);src=String(item.src||'').trim();}
    if(!src)continue;
    if(!/^https?:\/\//i.test(src)||src.length>2000)return {ok:false,error:'Caption URL must be an http(s) URL up to 2,000 characters.'};
    if(!/\.vtt(\?|#|$)/i.test(src))return {ok:false,error:'Captions must be WebVTT (.vtt) files.'};
    out.push({label:label||srclang,srclang:/^[a-z]{2,3}(-[a-z]{2,4})?$/i.test(srclang)?srclang:'en',src});
  }
  return {ok:true,value:out};
}
/** Shared lesson-media validation for create + PATCH. Returns {ok, error?, fields}. */
function validateLessonMedia(body,course,auth){
  const kindCheck=validateLessonKind(body.kind);if(!kindCheck.ok)return kindCheck;
  const srcCheck=validateVideoSources(body.videoSources);if(!srcCheck.ok)return srcCheck;
  const capCheck=validateCaptions(body.captions);if(!capCheck.ok)return capCheck;
  const fields={};
  if(kindCheck.value)fields.kind=kindCheck.value;
  if(body.videoSources!==undefined)fields.videoSources=srcCheck.value;
  if(body.captions!==undefined)fields.captions=capCheck.value;
  if(body.transcript!==undefined)fields.transcript=String(body.transcript||'').slice(0,20000);
  if(body.quizId!==undefined){
    if(!body.quizId){fields.quizId=null;}
    else{const q=(store.quizzes||[]).find(x=>x.id===String(body.quizId));if(!q||(q.ownerId!==auth.id&&auth.role!=='admin'))return {ok:false,error:'Quiz not found or not yours.'};fields.quizId=q.id;}
  }
  if(body.assignmentId!==undefined){
    if(!body.assignmentId){fields.assignmentId=null;}
    else{const a=(store.assignments||[]).find(x=>x.id===String(body.assignmentId));if(!a||(a.teacherId!==auth.id&&auth.role!=='admin'))return {ok:false,error:'Assignment not found or not yours.'};fields.assignmentId=a.id;}
  }
  return {ok:true,fields};
}
function canViewCourseDiscussions(user,course){if(!course||!user)return false;if(user.role==='admin')return true;if(course.ownerId===user.id)return true;
  if(course.status&&course.status!=='draft')return true;
  return (store.enrollments||[]).some(e=>e.studentId===user.id&&e.courseId===course.id);}
function liveClassroomAccess(user,session){if(!user||!session)return false;
  if(session.ownerId===user.id||user.role==='admin')return true;
  if(user.role!=='student')return true;
  if(!session.courseId)return true;
  const course=(store.courses||[]).find(c=>c.id===session.courseId);
  const enrolled=(store.enrollments||[]).some(e=>e.studentId===user.id&&e.courseId===session.courseId);
  return enrolled||(course&&course.status==='published');}
/** ---- Classroom session records (slice 2): validate + merge a client summary ----
 * The client reports per-participant activity (chat/Q&A/hand raises/poll votes) when
 * the teacher ends the classroom. Server join/attendance data is the source of truth
 * for WHO participated; client data only enriches those rows (plus anyone the client
 * saw who never hit the join endpoint). Counts are clamped, never trusted raw. */
const SESSION_RECORD_NOTE='Browser recording (.webm) is saved locally by the teacher — not uploaded.';
function clampCount(v,max){const n=Math.floor(Number(v));return Number.isFinite(n)?Math.max(0,Math.min(max,n)):0;}
function validateSessionSummary(body){
  const b=(body&&typeof body==='object'&&!Array.isArray(body))?body:{};
  const participants=[];
  if(Array.isArray(b.participants)){
    for(const p of b.participants.slice(0,200)){
      if(!p||typeof p!=='object'||typeof p.userId!=='string'||!p.userId.trim())continue;
      participants.push({userId:p.userId.trim().slice(0,80),
        name:typeof p.name==='string'?p.name.trim().slice(0,120):'',
        joinedAt:typeof p.joinedAt==='string'?p.joinedAt.slice(0,40):'',
        leftAt:typeof p.leftAt==='string'?p.leftAt.slice(0,40):'',
        raisedHand:clampCount(p.raisedHand,10000),chatCount:clampCount(p.chatCount,10000),
        qaCount:clampCount(p.qaCount,10000),pollVotes:clampCount(p.pollVotes,1000)});
    }
  }
  const polls=[];
  if(Array.isArray(b.polls)){
    for(const pl of b.polls.slice(0,20)){
      if(!pl||typeof pl!=='object'||typeof pl.question!=='string'||!pl.question.trim())continue;
      const options=Array.isArray(pl.options)?pl.options.filter(o=>typeof o==='string').map(o=>o.slice(0,120)).slice(0,10):[];
      const votes=Array.isArray(pl.votes)?pl.votes.map(v=>clampCount(v,100000)).slice(0,200):[];
      polls.push({question:pl.question.trim().slice(0,300),options,votes});
    }
  }
  return {participants,chatCount:clampCount(b.chatCount,100000),qaCount:clampCount(b.qaCount,100000),polls};
}
function buildSessionRecord(session,summary){
  const byId=new Map();
  for(const uid of (session.attendees||[])){
    const att=(session.attendance||[]).find(a=>a.userId===uid);
    const u=store.users.find(x=>x.id===uid);
    byId.set(uid,{userId:uid,name:(att&&att.name)||(u&&u.name)||'Participant',joinedAt:(att&&att.joinedAt)||'',leftAt:null,raisedHand:0,chatCount:0,qaCount:0,pollVotes:0});
  }
  for(const a of (session.attendance||[])){
    if(!byId.has(a.userId)){const u=store.users.find(x=>x.id===a.userId);byId.set(a.userId,{userId:a.userId,name:a.name||(u&&u.name)||'Participant',joinedAt:a.joinedAt||'',leftAt:null,raisedHand:0,chatCount:0,qaCount:0,pollVotes:0});}
  }
  for(const p of summary.participants){
    const row=byId.get(p.userId);
    if(row){if(p.name)row.name=p.name;if(p.joinedAt&&!row.joinedAt)row.joinedAt=p.joinedAt;if(p.leftAt)row.leftAt=p.leftAt;row.raisedHand=p.raisedHand;row.chatCount=p.chatCount;row.qaCount=p.qaCount;row.pollVotes=p.pollVotes;}
    else byId.set(p.userId,{userId:p.userId,name:p.name||'Participant',joinedAt:p.joinedAt||'',leftAt:p.leftAt||null,raisedHand:p.raisedHand,chatCount:p.chatCount,qaCount:p.qaCount,pollVotes:p.pollVotes});
  }
  const participants=[...byId.values()].sort((a,b)=>String(a.joinedAt||'').localeCompare(String(b.joinedAt||''))||String(a.name).localeCompare(String(b.name)));
  const endedAt=new Date().toISOString();
  const startMs=new Date(session.startsAt).getTime(),endedMs=new Date(endedAt).getTime();
  const actualMin=Number.isFinite(startMs)?Math.round((endedMs-startMs)/60000):NaN;
  const durationMin=Number.isFinite(actualMin)&&actualMin>0?actualMin:(session.durationMin||0);
  const course=session.courseId?(store.courses||[]).find(c=>c.id===session.courseId):null;
  const teacher=store.users.find(u=>u.id===session.ownerId);
  return {id:randomUUID(),sessionId:session.id,title:session.title,courseId:session.courseId||null,
    teacherId:session.ownerId,institutionId:(course&&course.institutionId)||(teacher&&teacher.institutionId)||null,
    startedAt:session.startsAt,endedAt,durationMin,participants,
    chatCount:summary.chatCount||participants.reduce((n,p)=>n+p.chatCount,0),
    qaCount:summary.qaCount||participants.reduce((n,p)=>n+p.qaCount,0),
    polls:summary.polls,recordingNote:SESSION_RECORD_NOTE,createdAt:endedAt};
}
function sessionRecordVisible(user,record){
  if(!user||!record)return false;
  if(org.isAdminRole(user.role)){const s=org.orgScope(user);return !s.institutionId||!record.institutionId||record.institutionId===s.institutionId;}
  if(record.teacherId===user.id)return true;
  return (record.participants||[]).some(p=>p.userId===user.id);
}
function sessionUser(req) { const id=parseCookies(req.headers.cookie||'').eduverse_session,session=id&&sessions.get(id); if(!session)return null; if(session.expiresAt<Date.now()){sessions.delete(id);if(dropStoredSession(id))persist().catch(()=>{});return null;} const user=store.users.find(item=>item.id===session.userId&&item.status==='active'); if(user){session.expiresAt=Date.now()+SESSION_MS;const row=(store.sessions||[]).find(s=>s.id===id);if(row)row.expiresAt=session.expiresAt;return user;} return null; }
/** Resolve a Bearer JWT to a user (null on any failure). Re-resolves from the
 *  store on every request, so role/status changes apply immediately. */
function bearerUser(req) { const m=/^Bearer\s+(.+)$/i.exec(String(req.headers.authorization||'').trim()); if(!m) return null; const v=jwt.verify(m[1]); if(!v.ok) return null; const user=store.users.find(u=>u.id===v.payload.sub&&u.status==='active'); return user||null; }
/** Session cookie first, Bearer JWT second — both produce the same req.auth shape. */
function authUser(req) { return sessionUser(req)||bearerUser(req); }
function startSession(res,user){ const sid=randomBytes(32).toString('base64url'); const sess={userId:user.id,expiresAt:Date.now()+SESSION_MS}; sessions.set(sid,sess); storeSessionRow(sid,sess); const loginDay=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Kolkata'}).format(new Date());if(!store.loginHistory)store.loginHistory=[];let history=store.loginHistory.find(h=>h.userId===user.id);if(!history){history={userId:user.id,days:[]};store.loginHistory.push(history);}history.days=Array.isArray(history.days)?history.days:[];if(!history.days.includes(loginDay))history.days.push(loginDay);history.days=history.days.slice(-365);persist().catch(()=>{});setSessionCookie(res,sid); return sid; }
/** Derive a valid unique username from an email local part (Google sign-in). */
function usernameFromEmail(email) {
  let local=String(email||'').split('@')[0].toLowerCase().replace(/[^a-z0-9._-]/g,'.').replace(/^\.+/,'').replace(/\.+$/,'').slice(0,28);
  if(local.length<3)local=(local+'user').slice(0,28);
  if(!/^[a-z0-9]/.test(local))local='u'+local;
  let candidate=local,n=2;
  while(store.users.some(u=>(u.username||'').toLowerCase()===candidate)){candidate=(local+'-'+n).slice(0,30);n++;}
  return candidate;
}
/** Google find-or-create: match by googleId, then by email, else create a student.
 *  Never attaches Google login to a non-active account (approval cannot be bypassed). */
async function findOrCreateGoogleUser(profile) {
  let user=store.users.find(u=>u.googleId===profile.googleId);
  if(user){ if(user.status!=='active')throw new Error('This account is not currently active. Contact your administrator.'); if(profile.emailVerified&&!user.emailVerified){user.emailVerified=true;await persist();} return user; }
  const emailLower=(profile.email||'').toLowerCase();
  if(emailLower)user=store.users.find(u=>(u.email||'').toLowerCase()===emailLower);
  if(user){ if(user.status!=='active')throw new Error('This account is pending administrator approval.'); user.googleId=profile.googleId; if(profile.emailVerified)user.emailVerified=true; await persist(); return user; }
  const defaultInst=(store.institutions||[]).find(i=>i.status==='active')||(store.institutions||[])[0];
  user={id:randomUUID(),name:(profile.name||'Google user').slice(0,80),username:usernameFromEmail(emailLower),email:emailLower,phone:'',passwordHash:await passwordHash(randomBytes(24).toString('hex')),role:'student',status:'active',institutionId:defaultInst?defaultInst.id:null,campusId:null,departmentId:null,googleId:profile.googleId,emailVerified:!!profile.emailVerified,termsAccepted:true,createdAt:new Date().toISOString()};
  store.users.push(user);await persist();return user;
}
function publicAuthPath(pathname) { if(pathname==='/api/plans'||pathname==='/api/payments/webhook'||pathname==='/lti/launch'||pathname.startsWith('/api/certificates/verify/'))return true; return ['/api/health','/api/settings','/api/institution/branding','/api/marketplace/courses','/api/auth/bootstrap-status','/api/auth/signup','/api/auth/login','/api/auth/logout','/api/auth/forgot-password','/api/auth/reset-password','/api/auth/setup-admin','/api/auth/refresh','/api/auth/verify-email','/api/auth/google','/api/auth/google/callback','/api/auth/google/status'].includes(pathname); }
function consumeLoginAttempt(key) { const now=Date.now(),old=loginAttempts.get(key)||[];const recent=old.filter(t=>now-t<60_000);if(recent.length>=8)return false;recent.push(now);loginAttempts.set(key,recent);return true; }
function probeOpenCv() {
  return new Promise(resolve => {
    const request = http.get('http://127.0.0.1:4174/health', response => {
      response.resume();
      resolve(response.statusCode === 200);
    });
    request.setTimeout(700, () => request.destroy());
    request.on('error', () => resolve(false));
  });
}
async function startOpenCvService() {
  if (stopping || openCvProcess || await probeOpenCv()) return;
  const python = path.join(OPENCV_DIR, '.venv-mediapipe', 'bin', 'python');
  const child = spawn(python, ['server.py'], {cwd: OPENCV_DIR, stdio: ['ignore', 'pipe', 'pipe']});
  openCvProcess = child;
  child.stdout.on('data', data => process.stdout.write(`[opencv] ${data}`));
  child.stderr.on('data', data => process.stderr.write(`[opencv] ${data}`));
  child.once('error', error => {
    if (openCvProcess === child) openCvProcess = null;
    console.warn(`[opencv] Could not start the bundled Python environment: ${error.message}`);
  });
  child.once('exit', (code, signal) => {
    if (openCvProcess === child) openCvProcess = null;
    if (!stopping) console.warn(`[opencv] Service stopped (${signal || code}). Install opencv-drawing/requirements-mediapipe.txt and restart EduVerse.`);
  });
}
async function bootstrapAdmin() {
 const bootAdminEmail=String(process.env.EDUVERSE_BOOTSTRAP_ADMIN_EMAIL||'').trim().toLowerCase(),password=process.env.EDUVERSE_BOOTSTRAP_ADMIN_PASSWORD||'';
 if(!bootAdminEmail&&!password)return;
 if(!bootAdminEmail||password.length<12)throw new Error('Admin bootstrap requires EDUVERSE_BOOTSTRAP_ADMIN_EMAIL and a 12+ character EDUVERSE_BOOTSTRAP_ADMIN_PASSWORD.');
 if(store.users.some(u=>u.role==='admin'))return;
 const user={id:randomUUID(),name:'EduVerse Administrator',email:bootAdminEmail,passwordHash:await passwordHash(password),role:'admin',status:'active',createdAt:new Date().toISOString()};store.users.push(user);audit({id:'bootstrap'},'Created initial administrator',bootAdminEmail);await persist();console.log(`Created initial administrator account for ${bootAdminEmail}`);
}
const STATIC_ALLOWLIST=new Set(['/index.html','/app.js','/security-utils.js','/styles.css','/vision-hands.js','/404.html','/terms.html','/privacy.html']);
function serveStatic(req,res,pathname) {
 const route=pathname==='/'?'/index.html':pathname;
 if(!STATIC_ALLOWLIST.has(route)){
   if(req.method==='GET'||req.method==='HEAD'){
     let notFound;try{notFound=path.resolve(PROJECT_ROOT,'404.html');}catch{}
     if(notFound&&notFound.startsWith(PROJECT_ROOT+path.sep))return fs.stat(notFound,(err,stat)=>{if(err||!stat.isFile())return send(res,404,{error:'Not found'});res.writeHead(404,{'Content-Type':'text/html; charset=utf-8','X-Content-Type-Options':'nosniff','X-Frame-Options':'DENY','Referrer-Policy':'no-referrer','Permissions-Policy':'camera=(self), microphone=(), geolocation=()','Content-Security-Policy':"default-src 'self'; style-src 'self' 'unsafe-inline'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'",'Cache-Control':'no-store'});if(req.method==='HEAD')return res.end();fs.createReadStream(notFound).pipe(res);});
   }
   return send(res,404,{error:'Not found'});
 }
 let file;try{file=path.resolve(PROJECT_ROOT,'.'+decodeURIComponent(route));}catch{return send(res,400,{error:'Invalid path'});}
 if(!file.startsWith(PROJECT_ROOT+path.sep))return send(res,403,{error:'Forbidden'});
 fs.stat(file,(err,stat)=>{if(err||!stat.isFile())return send(res,404,{error:'Not found'});const types={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.png':'image/png','.jpg':'image/jpeg','.svg':'image/svg+xml','.ico':'image/x-icon'};const extension=path.extname(file);res.writeHead(200,{'Content-Type':types[extension]||'application/octet-stream','X-Content-Type-Options':'nosniff','X-Frame-Options':'DENY','Referrer-Policy':'no-referrer','Permissions-Policy':'camera=(self), microphone=(), geolocation=()','Content-Security-Policy':"default-src 'self'; img-src 'self' https: data:; style-src 'self' https://fonts.googleapis.com 'unsafe-inline'; font-src 'self' https://fonts.gstatic.com; script-src 'self'; connect-src 'self' http://127.0.0.1:4174; frame-src 'self' blob:; frame-ancestors 'none'; base-uri 'self'; form-action 'self'",'Cache-Control':['.html','.js','.css'].includes(extension)?'no-cache, must-revalidate':'public, max-age=3600'});fs.createReadStream(file).pipe(res);});
}
const MAX_BODY = 64 * 1024; // Notes allow 12,000 characters; JSON escaping can inflate that.
const MAX_UPLOAD_BODY = 8 * 1024 * 1024; // Base64 JSON uploads: a 5MB file is ~6.8MB encoded.
const MAX_IMPORT_BODY = 2 * 1024 * 1024; // Bulk CSV import text.
const MAX_BACKUP_BODY = 50 * 1024 * 1024; // Full-store backup restore (super_admin only).
function readBody(req, opts) {
  const limit = (opts && Number(opts.maxBytes) > 0) ? Number(opts.maxBytes) : MAX_BODY;
  const limitLabel = limit >= 1024 * 1024 ? `${Math.round(limit / 1024 / 1024)} MB` : `${Math.round(limit / 1024)} KB`;
  return new Promise((resolve, reject) => {
    let raw = '', tooBig = false;
    req.on('data', chunk => { if (tooBig) return; raw += chunk; if (raw.length > limit) { tooBig = true; raw = ''; } });
    req.on('end', () => {
      if (tooBig) return reject(new Error(`Request body too large (max ${limitLabel})`));
      if (opts && opts.raw) return resolve({ body: raw ? JSON.parse(raw) : {}, raw: Buffer.from(raw) });
      try { resolve(raw ? JSON.parse(raw) : {}); } catch { reject(new Error('Body must be valid JSON')); }
    });
    req.on('error', reject);
  });
}
/** Read a raw binary body (for LTI form posts and SCORM zip uploads). */
function readRawBody(req, maxBytes) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', chunk => {
      size += chunk.length;
      if (size > maxBytes) { reject(new Error(`Request body too large (max ${Math.round(maxBytes / 1024 / 1024)} MB)`)); req.destroy(); return; }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}
/** Minimal multipart/form-data parser. Returns {fields, files:[{field,name,filename,mime,data}]}. */
function parseMultipart(buffer, contentType) {
  const m = String(contentType || '').match(/boundary=(?:"([^"]+)"|([^\s;]+))/i);
  if (!m) throw new Error('Missing multipart boundary.');
  const boundary = Buffer.from('--' + (m[1] || m[2]));
  const fields = {}, files = [];
  let start = 0;
  const parts = [];
  while (true) {
    const b = buffer.indexOf(boundary, start);
    if (b < 0) break;
    if (start > 0) parts.push(buffer.subarray(start, b));
    start = b + boundary.length;
  }
  for (let part of parts) {
    if (part.subarray(0, 2).equals(Buffer.from('--'))) break; // closing boundary
    if (part.subarray(0, 2).equals(Buffer.from('\r\n'))) part = part.subarray(2);
    const headerEnd = part.indexOf(Buffer.from('\r\n\r\n'));
    if (headerEnd < 0) continue;
    const headers = part.subarray(0, headerEnd).toString('latin1');
    let data = part.subarray(headerEnd + 4);
    if (data.subarray(data.length - 2).equals(Buffer.from('\r\n'))) data = data.subarray(0, data.length - 2);
    const nameM = headers.match(/name="([^"]*)"/i);
    const fileM = headers.match(/filename="([^"]*)"/i);
    const typeM = headers.match(/content-type:\s*([^\r\n;]+)/i);
    if (!nameM) continue;
    if (fileM) files.push({ field: nameM[1], filename: fileM[1].split(/[\\/]/).pop().slice(0, 120), mime: (typeM ? typeM[1].trim() : 'application/octet-stream').slice(0, 120), data });
    else fields[nameM[1]] = data.toString('utf8');
  }
  return { fields, files };
}
function courseReviewSummary(courseId) {
  const rows=(store.courseReviews||[]).filter(r=>r.courseId===courseId);
  return {reviewCount:rows.length,averageRating:rows.length?Math.round(rows.reduce((sum,r)=>sum+r.rating,0)/rows.length*10)/10:0};
}
function ensureVisionStats(vision) {
  if (!vision.experiments || !Object.keys(vision.experiments).length) {
    vision.experiments = {};
    const completed = new Set();
    for (const event of vision.events || []) {
      const item = vision.experiments[event.experimentId] || {attempts:0,mistakes:0,skills:[],xp:0};
      item.attempts++;
      if (event.mistake || (event.type==='challenge' && Number(event.score)<60)) item.mistakes++;
      item.skills=[...new Set([...item.skills,...(event.skills||[])])];
      item.recommendedNext=event.recommendedNext||item.recommendedNext||null;
      if (event.type==='completed' && !completed.has(event.experimentId)) {item.xp+=25;completed.add(event.experimentId);}
      else if(event.type==='challenge') item.xp+=Math.round((Number(event.score)||0)/20);
      item.lastScore=event.score;item.lastActivity=event.createdAt;vision.experiments[event.experimentId]=item;
    }
    vision.xp=Object.values(vision.experiments).reduce((sum,item)=>sum+(Number(item.xp)||0),0);
  }
  return vision;
}
async function route(req, res) {
  if (req.method === 'OPTIONS') {res.writeHead(204,{});return res.end();}
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const origin=req.headers.origin;
  let expectedOrigin;
  expectedOrigin=APP_BASE_ORIGIN||`${req.socket.encrypted?'https':'http'}://${req.headers.host||'127.0.0.1'}`;
  if(origin&&origin!==expectedOrigin)return send(res,403,{error:'Request origin is not allowed.'});
  if (req.method === 'GET' && url.pathname === '/api/health') return send(res, 200, {ok:true,service:'eduverse-learning-api'});
  if (req.method === 'GET' && url.pathname === '/api/auth/bootstrap-status') return send(res,200,{administratorProvisioned:store.users.some(u=>u.role==='admin')});
  if (req.method === 'GET' && url.pathname === '/api/auth/me') { const user=authUser(req);return user?send(res,200,{user:publicUser(user)}):send(res,401,{error:'Sign in required'}); }
  if (req.method === 'POST' && url.pathname === '/api/auth/logout') return readBody(req).then(async body=>{
    const me=authUser(req); // captured before the session is deleted below
    const id=parseCookies(req.headers.cookie||'').eduverse_session;if(id)removeSession(id);
    if(body&&body.refreshToken)jwt.revokeRefresh(String(body.refreshToken));
    else if(me)jwt.revokeAllForUser(me.id);
    clearSessionCookie(res);await persist().catch(()=>{});return send(res,200,{ok:true});
  }).catch(e=>send(res,400,{error:e.message}));
  if (req.method === 'POST' && url.pathname === '/api/auth/signup') return readBody(req).then(async body=>{
    if(!consumeRate(signupAttempts, req.socket.remoteAddress||'local', 10, 60*60*1000)){ sec.logEvent({type:'rate_limited',severity:'low',actor:String(body.username||''),detail:'signup rate limit',ip:clientIp(req)}); return send(res,429,{error:'Too many registrations from this address. Try again later.'}); }
    const name=String(body.name||'').trim(),username=String(body.username||'').trim().toLowerCase(),password=String(body.password||''),role=body.role;
    if(name.length<2||name.length>80)return send(res,400,{error:'Enter a name between 2 and 80 characters.'});
    if(!/^[a-z0-9][a-z0-9._-]{2,29}$/.test(username))return send(res,400,{error:'Use a username with 3–30 letters, numbers, dots, underscores, or hyphens.'});
    if(password.length<12||password.length>256)return send(res,400,{error:'Use a password between 12 and 256 characters.'});
    if(body.termsAccepted!==true)return send(res,400,{error:'Accept the Terms and Privacy Policy to create an account.'});
    if(!['student','teacher','parent'].includes(role))return send(res,403,{error:'Administrator accounts are created only through secure administrator setup.'});
    if(store.users.some(u=>(u.username||'').toLowerCase()===username))return send(res,409,{error:'That username is already in use. Choose another one.'});
    if(role==='teacher'&&process.env.NODE_ENV==='production')return send(res,503,{error:'Teacher self-signup is disabled in production until a real email verification provider is configured. Ask an administrator to create your account.'});
    if(role==='teacher'&&(body.otpVerified!==true||!(/^\d{4,8}$/).test(String(body.otpCode||''))))return send(res,400,{error:'Teacher signup requires a verified demo OTP.'});
    if(role==='student'&&store.settings.allowStudentRegistration===false)return send(res,403,{error:'Student registration is currently closed by the administrator.'});
    const pending=role==='teacher'&&store.settings.requireTeacherApproval!==false,defaultInst=(store.institutions||[]).find(i=>i.status==='active')||(store.institutions||[])[0],user={id:randomUUID(),name,username,email:'',phone:'',passwordHash:await passwordHash(password),role,status:pending?'pending':'active',institutionId:defaultInst?defaultInst.id:null,campusId:null,departmentId:null,createdAt:new Date().toISOString()};
    store.users.push(user);await persist();
    if(pending)return send(res,201,{pending:true,message:'Teacher access requires administrator approval.'});
    const pair=jwt.issueTokenPair(user);await persist();
    send(res,201,{created:true,user:publicUser(user),message:'Account created. Sign in to continue.',...pair});
  }).catch(e=>send(res,400,{error:e.message}));
  if (req.method === 'POST' && url.pathname === '/api/auth/login') return readBody(req).then(async body=>{
    const identifier=String(body.identifier||body.email||'').trim().toLowerCase(),key=(req.socket.remoteAddress||'local')+':'+identifier;
    const lip=clientIp(req);
    if(!consumeLoginAttempt(key)){ sec.logEvent({type:'rate_limited',severity:'low',actor:identifier,detail:'login attempt rate limit',ip:lip}); return send(res,429,{error:'Too many attempts. Wait a minute and try again.'}); }
    if(!consumeRate(ipLoginAttempts, lip, 30, 60_000)){ sec.logEvent({type:'rate_limited',severity:'low',actor:identifier,detail:'login IP rate limit',ip:lip}); return send(res,429,{error:'Too many attempts from this address. Wait a minute and try again.'}); }
    const user=store.users.find(u=>(u.email||'').toLowerCase()===identifier||(u.username||'').toLowerCase()===identifier),ok=user&&await passwordMatches(String(body.password||''),user.passwordHash);
    if(!ok){ sec.logEvent({institutionId:user?(user.institutionId||null):null,type:'login_failed',severity:'medium',actor:identifier,detail:'invalid credentials',ip:lip}); sec.checkBruteForce(lip); return send(res,401,{error:'Username or password was not recognized.'}); }
    if(user.status==='pending')return send(res,403,{error:'Teacher access is pending administrator approval.'});
    if(user.status!=='active')return send(res,403,{error:'This account is not currently active. Contact your administrator.'});
    if(user.mfaEnabled){ if(!totpValid(user.mfaSecret, body.mfaCode)) return send(res,401,{error:'Enter the current 6-digit authenticator code for this account.'}); }
    startSession(res,user);
    const pair=jwt.issueTokenPair(user);
    store.loginEvents.unshift({at:new Date().toISOString(),userId:user.id,institutionId:user.institutionId||null,ip:lip,userAgent:String(req.headers['user-agent']||'').slice(0,300)});
    store.loginEvents=store.loginEvents.slice(0,2000);
    persist().catch(()=>{});
    send(res,200,{user:publicUser(user),...pair});
  }).catch(e=>send(res,400,{error:e.message}));
  if (req.method.startsWith('GET') && !url.pathname.startsWith('/api/')) {
    if (url.pathname.startsWith('/scorm-content/')) {
      // Serve extracted SCORM package files (capability URLs: packageId is an unguessable UUID).
      const rest = decodeURIComponent(url.pathname.slice(15));
      const slash = rest.indexOf('/');
      const pkgId = slash < 0 ? rest : rest.slice(0, slash);
      const rel = slash < 0 ? '' : rest.slice(slash + 1);
      if (!/^[a-z0-9-]{8,60}$/i.test(pkgId)) return send(res, 400, { error: 'Invalid path' });
      const pkg = (store.scormPackages || []).find(p => p.id === pkgId);
      if (!pkg) return send(res, 404, { error: 'Not found' });
      const base = path.join(storage.UPLOAD_DIR, 'scorm', pkgId);
      const file = path.normalize(path.join(base, rel || 'index.html'));
      if (!file.startsWith(base)) return send(res, 400, { error: 'Invalid path' });
      return fs.stat(file, (err, stat) => {
        if (err || !stat.isFile()) return send(res, 404, { error: 'Not found' });
        const types = { '.html': 'text/html; charset=utf-8', '.htm': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.xml': 'text/xml', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.gif': 'image/gif', '.webp': 'image/webp', '.svg': 'image/svg+xml', '.mp4': 'video/mp4', '.webm': 'video/webm', '.pdf': 'application/pdf', '.txt': 'text/plain', '.vtt': 'text/vtt' };
        // Allow framing by the EduVerse SCORM player (same origin).
        res.writeHead(200, { 'Content-Type': types[path.extname(file).toLowerCase()] || 'application/octet-stream', 'X-Content-Type-Options': 'nosniff', 'Cache-Control': 'public, max-age=3600' });
        fs.createReadStream(file).pipe(res);
      });
    }
    if (url.pathname.startsWith('/uploads/')) {
      // Serve locally-stored uploads (storage.js local provider)
      const name = path.basename(decodeURIComponent(url.pathname.slice(9)));
      if (!name || name.includes('..')) return send(res, 400, { error: 'Invalid path' });
      const file = path.join(storage.UPLOAD_DIR, name);
      return fs.stat(file, (err, stat) => {
        if (err || !stat.isFile()) return send(res, 404, { error: 'Not found' });
        const types = { '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.gif': 'image/gif', '.webp': 'image/webp', '.svg': 'image/svg+xml', '.mp4': 'video/mp4', '.webm': 'video/webm', '.pdf': 'application/pdf', '.vtt': 'text/vtt', '.txt': 'text/plain' };
        res.writeHead(200, { 'Content-Type': types[path.extname(name).toLowerCase()] || 'application/octet-stream', 'X-Content-Type-Options': 'nosniff', 'Cache-Control': 'public, max-age=3600' });
        fs.createReadStream(file).pipe(res);
      });
    }
    return serveStatic(req,res,url.pathname);
  }
  // ----- LTI 1.1 tool-provider launch (public; OAuth 1.0a verified) -----
  // Must sit before the /api/ gate: /lti/launch is not under /api/.
  if (req.method === 'POST' && url.pathname === '/lti/launch') {
    const raw = await readRawBody(req, 256 * 1024).catch(e => null);
    if (!raw) return send(res, 400, { error: 'Could not read launch body.' });
    const params = {};
    for (const [k, v] of new URLSearchParams(raw.toString('utf8'))) params[k] = v;
    const launchUrl = `${req.socket.encrypted ? 'https' : 'http'}://${req.headers.host || '127.0.0.1'}/lti/launch`;
    const verified = standards.verifyLtiLaunch({ method: 'POST', url: launchUrl, params });
    if (!verified.ok) { sec.logEvent({ type: 'login_failed', severity: 'medium', actor: String(params.oauth_consumer_key || '?'), detail: 'LTI launch rejected: ' + verified.error, ip: clientIp(req) }); return send(res, 401, { error: 'Launch rejected: ' + verified.error }); }
    const consumer = verified.consumer;
    const extUserId = String(params.user_id || '').slice(0, 120);
    if (!extUserId) return send(res, 400, { error: 'Launch is missing user_id.' });
    const fullName = String(params.lis_person_name_full || '').trim()
      || [params.lis_person_name_given, params.lis_person_name_family].filter(Boolean).join(' ').trim()
      || 'LTI learner';
    const roles = String(params.roles || '').toLowerCase();
    const role = /instructor|administrator/.test(roles) ? 'teacher' : 'student';
    const username = ('lti_' + consumer.key.replace(/[^a-z0-9]/gi, '').slice(0, 12) + '_' + extUserId.replace(/[^a-z0-9]/gi, '').slice(0, 24)).toLowerCase();
    let user = store.users.find(u => u.ltiConsumerKey === consumer.key && u.ltiUserId === extUserId && u.status === 'active');
    if (!user) {
      if (store.users.some(u => (u.username || '').toLowerCase() === username)) return send(res, 409, { error: 'Username collision for provisioned LTI account.' });
      user = { id: randomUUID(), name: fullName.slice(0, 80), username, email: String(params.lis_person_contact_email_primary || '').slice(0, 254), passwordHash: await passwordHash(randomBytes(24).toString('hex')), role, status: 'active', institutionId: consumer.institutionId, campusId: null, departmentId: null, ltiConsumerKey: consumer.key, ltiUserId: extUserId, termsAccepted: true, createdAt: new Date().toISOString() };
      store.users.push(user);
    }
    // Enroll in the consumer's linked course.
    if (consumer.courseId && !(store.enrollments || []).some(e => e.studentId === user.id && e.courseId === consumer.courseId)) {
      store.enrollments.unshift({ id: randomUUID(), studentId: user.id, courseId: consumer.courseId, enrolledAt: new Date().toISOString(), via: 'lti' });
    }
    consumer.launchCount = (consumer.launchCount || 0) + 1;
    store.ltiLaunches.unshift({ id: randomUUID(), consumerId: consumer.id, userId: user.id, at: new Date().toISOString() });
    store.ltiLaunches = store.ltiLaunches.slice(0, 1000);
    startSession(res, user);
    await persist();
    const returnUrl = String(params.launch_presentation_return_url || '').slice(0, 500);
    // The SPA has no deep course URL; land on the app (user is signed in + enrolled).
    const dest = /^https?:\/\//i.test(returnUrl) ? returnUrl : '/';
    res.writeHead(302, { Location: dest, 'Cache-Control': 'no-store' });
    return res.end();
  }
  if (!url.pathname.startsWith('/api/')) return send(res,404,{error:'Route not found'});
  req.auth=publicAuthPath(url.pathname)?null:authUser(req);
  // Service-key bypass for automated backups (BACKUP_API_KEY) — checked before auth gates.
  const backupKey = process.env.BACKUP_API_KEY;
  if (backupKey && req.method === 'GET' && url.pathname === '/api/admin/backup/download' && req.headers['x-backup-key'] === backupKey) {
    req.auth = { id: 'backup-service', role: 'super_admin', username: 'backup-service' };
  }
  if(!publicAuthPath(url.pathname)&&!req.auth)return send(res,401,{error:'Sign in required'});
  // Slice 4: vocab + speaking admin paths are teacher-manageable (contract: teacher or lang.manage).
  const langTeacherPath = (url.pathname === '/api/admin/vocab' || url.pathname.startsWith('/api/admin/vocab/') || url.pathname === '/api/admin/speaking' || url.pathname.startsWith('/api/admin/speaking/')) && (req.auth?.role === 'teacher' || org.can(req.auth, 'lang.manage'));
  // Coding lab: challenge CRUD is teacher-manageable (contract: teacher or codelab.manage).
  const codelabTeacherPath = (url.pathname === '/api/teacher/challenges' || url.pathname.startsWith('/api/teacher/challenges/')) && (req.auth?.role === 'teacher' || org.can(req.auth, 'codelab.manage'));
  if(url.pathname.startsWith('/api/admin/')&&!org.isAdminRole(req.auth.role)&&!langTeacherPath){ sec.logEvent({institutionId:req.auth.institutionId||null,type:'forbidden_admin',severity:'medium',actor:req.auth.username||req.auth.id,detail:url.pathname.slice(0,200),ip:clientIp(req)}); return send(res,403,{error:'Administrator access required'}); }
  const studentTestSubmission=req.method==='POST'&&/^\/api\/teacher\/tests\/[^/]+\/attempts$/.test(url.pathname)&&req.auth?.role==='student';
  const studentTeacherSummary=req.method==='GET'&&url.pathname==='/api/teacher'&&req.auth?.role==='student';
  const studentAnnouncementRead=req.method==='GET'&&url.pathname==='/api/teacher/announcements'&&req.auth?.role==='student';
  if(url.pathname.startsWith('/api/teacher')&&!['teacher','admin'].includes(req.auth?.role)&&!studentTestSubmission&&!studentTeacherSummary&&!studentAnnouncementRead&&!codelabTeacherPath)return send(res,403,{error:'Teacher access required'});
  if(req.method==='POST'&&url.pathname==='/api/assignments'&&!['teacher','admin'].includes(req.auth?.role))return send(res,403,{error:'Teacher access required'});
  if(req.method==='POST'&&url.pathname.startsWith('/api/assignments/')&&url.pathname.endsWith('/submit')&&req.auth?.role!=='student')return send(res,403,{error:'Student access required'});
  // ----- JWT auth: refresh / token / email verification / Google login -----
  if (req.method === 'POST' && url.pathname === '/api/auth/refresh') return readBody(req).then(async body=>{
    const r=jwt.rotateRefresh(String(body.refreshToken||''));
    if(!r.ok)return send(res,401,{error:r.error});
    await persist();send(res,200,{user:publicUser(r.user),...r.pair});
  }).catch(e=>send(res,400,{error:e.message}));
  if (req.method === 'POST' && url.pathname === '/api/auth/token') return readBody(req).then(async body=>{
    const pair=jwt.issueTokenPair(req.auth);await persist();send(res,200,{user:publicUser(req.auth),...pair});
  }).catch(e=>send(res,400,{error:e.message}));
  if (req.method === 'POST' && url.pathname === '/api/auth/send-verification') return readBody(req).then(async body=>{
    const user=store.users.find(u=>u.id===req.auth.id);if(!user)return send(res,401,{error:'Sign in required'});
    const emailAddr=String(user.email||'').trim().toLowerCase();
    if(!emailAddr)return send(res,400,{error:'Add an email address to your profile first.'});
    if(!consumeRate(verifyAttempts,req.auth.id,3,60*60*1000))return send(res,429,{error:'Too many verification requests. Try again later.'});
    const token=randomBytes(32).toString('hex');
    store.emailVerifications=(store.emailVerifications||[]).filter(v=>v.expiresAt>Date.now());
    store.emailVerifications.push({id:randomUUID(),userId:user.id,tokenHash:await passwordHash(token),expiresAt:Date.now()+24*60*60*1000,createdAt:new Date().toISOString()});
    const link=`${process.env.APP_BASE_URL||'http://127.0.0.1:4173'}/#verify-email?token=${token}`;
    try{ await email.sendEmail({to:emailAddr,subject:'Verify your EduVerse email',html:`<p>Confirm your email within 24 hours:</p><p><a href="${link}">${link}</a></p>`}); }catch(e){ monitor.captureError(e,{kind:'verify-email'}); }
    await persist();
    send(res,200,{ok:true,message:'A verification link has been sent to your email address.'});
  }).catch(e=>send(res,400,{error:e.message}));
  if (req.method === 'POST' && url.pathname === '/api/auth/verify-email') return readBody(req).then(async body=>{
    const token=String(body.token||'');if(!token)return send(res,400,{error:'A verification token is required.'});
    let matched=null;for(const v of (store.emailVerifications||[])){if(v.expiresAt>Date.now()&&await passwordMatches(token,v.tokenHash)){matched=v;break;}}
    if(!matched)return send(res,400,{error:'That verification link is invalid or expired.'});
    const user=store.users.find(u=>u.id===matched.userId);if(!user)return send(res,404,{error:'Account not found.'});
    user.emailVerified=true;store.emailVerifications=store.emailVerifications.filter(v=>v.id!==matched.id);
    startSession(res,user);const pair=jwt.issueTokenPair(user);await persist();
    send(res,200,{ok:true,user:publicUser(user),...pair});
  }).catch(e=>send(res,400,{error:e.message}));
  if (req.method === 'GET' && url.pathname === '/api/auth/google/status') return send(res,200,{configured:google.configured()});
  if (req.method === 'GET' && url.pathname === '/api/auth/google') {
    if(!google.configured())return send(res,501,{error:'Google login is not configured — set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET.'});
    const state=jwt.sign({kind:'google-state',nonce:randomBytes(16).toString('hex')},600);
    res.writeHead(302,{Location:google.buildAuthUrl(state),'Cache-Control':'no-store'});return res.end();
  }
  if (req.method === 'GET' && url.pathname === '/api/auth/google/callback') {
    const fail=()=>{res.writeHead(302,{Location:'/?google=error','Cache-Control':'no-store'});return res.end();};
    if(url.searchParams.get('error')||!url.searchParams.get('code')||!url.searchParams.get('state'))return fail();
    const sv=jwt.verify(url.searchParams.get('state'));
    if(!sv.ok||sv.payload.kind!=='google-state')return fail();
    try{
      const tokens=await google.exchangeCode(url.searchParams.get('code'));
      const profile=await google.getUserInfo(tokens.access_token);
      if(!profile.googleId||!profile.email)return fail();
      const user=await findOrCreateGoogleUser(profile);
      startSession(res,user);await persist();
      res.writeHead(302,{Location:'/?google=ok','Cache-Control':'no-store'});return res.end();
    }catch(e){monitor.captureError(e,{kind:'google-callback'});return fail();}
  }
  if (req.method === 'POST' && url.pathname === '/api/auth/google') return readBody(req).then(async body=>{
    if(!google.configured())return send(res,501,{error:'Google login is not configured — set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET.'});
    const idToken=String(body.idToken||'');if(!idToken)return send(res,400,{error:'An ID token is required.'});
    let profile;try{profile=await google.verifyIdToken(idToken);}catch(e){return send(res,401,{error:String(e.message||'Google token verification failed.').slice(0,200)});}
    if(!profile.googleId||!profile.email)return send(res,401,{error:'Google did not return a usable profile.'});
    let user;try{user=await findOrCreateGoogleUser(profile);}catch(e){return send(res,403,{error:String(e.message||'Google sign-in is not available for this account.').slice(0,200)});}
    startSession(res,user);const pair=jwt.issueTokenPair(user);await persist();
    send(res,200,{user:publicUser(user),...pair});
  }).catch(e=>send(res,400,{error:e.message}));
  if(req.method==='PATCH'&&url.pathname==='/api/profile'){
    // Public profile fields may change, but browser requests can never change account roles.
    return readBody(req).then(async body=>{const user=store.users.find(u=>u.id===req.auth.id);if(!user)return send(res,401,{error:'Sign in required'});if(body.name!==undefined){if(typeof body.name!=='string'||body.name.trim().length<2||body.name.length>80)return send(res,400,{error:'Name must contain 2 to 80 characters.'});user.name=body.name.trim();}if(body.email!==undefined){const email=String(body.email||'').trim().toLowerCase();if(!/^\S+@\S+\.\S+$/.test(email)||email.length>254)return send(res,400,{error:'Enter a valid Gmail or email address.'});if(store.users.some(u=>u.id!==user.id&&(u.email||'').toLowerCase()===email))return send(res,409,{error:'That email address is already linked to an account.'});user.email=email;}if(body.phone!==undefined){const phone=String(body.phone||'').trim();if(!/^[+0-9 ()-]{7,20}$/.test(phone)||phone.replace(/\D/g,'').length<7||phone.replace(/\D/g,'').length>15)return send(res,400,{error:'Enter a valid mobile number with 7–15 digits.'});user.phone=phone;}if(body.bio!==undefined){if(typeof body.bio!=='string'||body.bio.length>280)return send(res,400,{error:'Bio must be 280 characters or fewer.'});user.bio=body.bio;}if(body.age!==undefined){if(body.age!==null&&(!Number.isInteger(Number(body.age))||Number(body.age)<5||Number(body.age)>120))return send(res,400,{error:'Age must be between 5 and 120.'});user.age=body.age===null?null:Number(body.age);}if(body.institution!==undefined){if(typeof body.institution!=='string'||body.institution.length>120)return send(res,400,{error:'School or workspace must be 120 characters or fewer.'});user.institution=body.institution;}if(body.preferences!==undefined){if(!body.preferences||typeof body.preferences!=='object'||Array.isArray(body.preferences))return send(res,400,{error:'Invalid preferences.'});const allowed={};if(body.preferences.theme!==undefined){if(!['light','dark','system'].includes(body.preferences.theme))return send(res,400,{error:'Invalid theme.'});allowed.theme=body.preferences.theme;}user.preferences={...(user.preferences||{}),...allowed};}await persist();send(res,200,{profile:publicProfile(user)});}).catch(e=>send(res,400,{error:e.message}));
  }
  if (req.method === 'PATCH' && /^\/api\/admin\/students\/[^/]+\/record$/.test(url.pathname)) return readBody(req).then(async body=>{if(!hasPerm('admin','canManageUsers'))return send(res,403,{error:'Student record management is disabled.'});const id=url.pathname.split('/')[4],student=store.users.find(u=>u.id===id&&u.role==='student');if(!student)return send(res,404,{error:'Student account not found.'});const registrationNumber=String(body.registrationNumber||'').trim().toUpperCase(),rollNumber=String(body.rollNumber||'').trim().toUpperCase(),grade=String(body.grade||'').trim(),section=String(body.section||'').trim(),guardianName=String(body.guardianName||'').trim(),guardianPhone=String(body.guardianPhone||'').trim();if(!/^[A-Z0-9][A-Z0-9/-]{1,29}$/.test(registrationNumber))return send(res,400,{error:'Enter a registration number using 2–30 letters, numbers, hyphens, or slashes.'});if(!/^[A-Z0-9][A-Z0-9/-]{0,19}$/.test(rollNumber))return send(res,400,{error:'Enter a valid roll number.'});if(grade.length>50||section.length>30||guardianName.length>80)return send(res,400,{error:'Grade, section, or guardian name is too long.'});if(guardianPhone&&(!/^[+0-9 ()-]{7,20}$/.test(guardianPhone)||guardianPhone.replace(/\D/g,'').length<7||guardianPhone.replace(/\D/g,'').length>15))return send(res,400,{error:'Enter a valid guardian phone number.'});if(store.users.some(u=>u.id!==id&&u.role==='student'&&u.registrationNumber===registrationNumber))return send(res,409,{error:'That registration number is already assigned.'});const rosterKey=`${grade.toLowerCase()}|${section.toLowerCase()}|${rollNumber}`;if(store.users.some(u=>u.id!==id&&u.role==='student'&&`${String(u.grade||'').toLowerCase()}|${String(u.section||'').toLowerCase()}|${String(u.rollNumber||'').toUpperCase()}`===rosterKey))return send(res,409,{error:'That roll number is already used in this grade and section.'});Object.assign(student,{registrationNumber,rollNumber,grade,section,guardianName,guardianPhone,recordUpdatedAt:new Date().toISOString()});audit(req.auth,'updated student record',`${student.id}:${registrationNumber}`);await persist();return send(res,200,{student:publicUser(student)});}).catch(e=>send(res,400,{error:e.message}));
  if (req.method === 'GET' && url.pathname === '/api/admin/users') {
    const q=String(url.searchParams.get('q')||'').trim().toLowerCase();
    const scope=org.orgScope(req.auth);
    const scoped=scope.institutionId?store.users.filter(u=>u.institutionId===scope.institutionId):store.users;
    const users=scoped.filter(u=>!q||`${u.name} ${u.email} ${u.role} ${u.status}`.toLowerCase().includes(q)).map(publicUser);
    return send(res,200,{users,metrics:{total:scoped.length,students:scoped.filter(u=>u.role==='student').length,teachers:scoped.filter(u=>u.role==='teacher').length,pendingTeachers:scoped.filter(u=>u.role==='teacher'&&u.status==='pending').length,classes:(store.classes||[]).length},audit:store.adminAudit||[]});
  }
  if (req.method === 'GET' && url.pathname === '/api/admin/overview') {
    const users=store.users||[],classes=store.classes||[],assignments=store.assignments||[],courses=store.courses||[];
    const submissions=assignments.flatMap(a=>Object.values(a.submissions||{}));
    const visionEvents=Object.values(store.userVision||{}).flatMap(v=>v.events||[]);
    return send(res,200,{metrics:{totalUsers:users.length,students:users.filter(u=>u.role==='student').length,teachers:users.filter(u=>u.role==='teacher').length,pendingTeachers:users.filter(u=>u.role==='teacher'&&u.status==='pending').length,activeCourses:courses.length,classes:classes.length,enrollments:classes.reduce((n,c)=>n+(c.studentIds||[]).length,0),submissions:submissions.length,visionEvents:visionEvents.length},audit:(store.adminAudit||[]).slice(0,30),courses:courses.map(({id,title,category,level})=>({id,title,category,level}))});
  }
  if (req.method === 'GET' && url.pathname === '/api/admin/audit') return send(res,200,{audit:(store.adminAudit||[]).slice(0,300)});
  if (req.method === 'GET' && url.pathname === '/api/admin/classes') return send(res,200,{classes:(store.classes||[]).map(c=>({...c,teachers:c.teacherIds.map(id=>store.users.find(u=>u.id===id)).filter(Boolean).map(publicUser),students:c.studentIds.map(id=>store.users.find(u=>u.id===id)).filter(Boolean).map(publicUser)})),users:store.users.filter(u=>u.status==='active').map(publicUser)});
  if (req.method === 'POST' && url.pathname === '/api/admin/classes') return readBody(req).then(async body=>{
    const name=String(body.name||'').trim(),teacherIds=Array.isArray(body.teacherIds)?[...new Set(body.teacherIds)]:[],studentIds=Array.isArray(body.studentIds)?[...new Set(body.studentIds)]:[];
    if(name.length<2||name.length>100)return send(res,400,{error:'Class name must contain 2 to 100 characters.'});
    if(!teacherIds.length||teacherIds.some(id=>!store.users.some(u=>u.id===id&&u.role==='teacher'&&u.status==='active')))return send(res,400,{error:'Select at least one approved teacher.'});
    if(studentIds.some(id=>!store.users.some(u=>u.id===id&&u.role==='student'&&u.status==='active')))return send(res,400,{error:'Only active student accounts can be enrolled.'});
    store.classes ||= [];const item={id:randomUUID(),name,subject:String(body.subject||'General').slice(0,100),teacherIds,studentIds,createdAt:new Date().toISOString()};store.classes.unshift(item);audit(req.auth,'created class',name);await persist();send(res,201,{class:item});
  }).catch(e=>send(res,400,{error:e.message}));
  if (req.method === 'PATCH' && url.pathname.startsWith('/api/admin/users/')) return readBody(req).then(async body=>{
    const id=url.pathname.split('/').at(-1),user=store.users.find(u=>u.id===id);if(!user)return send(res,404,{error:'User not found'});if(org.effectiveRole(user.role)==='super_admin')return send(res,403,{error:'Administrator accounts are protected from role and status edits here.'});
    const scope=org.orgScope(req.auth);if(scope.institutionId&&user.institutionId!==scope.institutionId)return send(res,403,{error:'This user belongs to another institution.'});
    const action=body.action;
    if(action==='approve'&&user.role==='teacher'&&user.status==='pending')user.status='active';
    else if(action==='reject'&&user.role==='teacher'&&user.status==='pending')user.status='rejected';
    else if(action==='suspend'&&user.status==='active')user.status='suspended';
    else if(action==='activate'&&user.status==='suspended')user.status='active';
    else if(action==='restore'&&user.status==='rejected')user.status=user.role==='teacher'?'pending':'active';
    else if(action==='set_org'){ if(org.effectiveRole(req.auth.role)!=='super_admin')return send(res,403,{error:'Only a super administrator can move users between institutions.'}); if(body.institutionId!==undefined){ const inst=(store.institutions||[]).find(i=>i.id===body.institutionId); if(!inst) return send(res,400,{error:'Choose an existing institution.'}); user.institutionId=inst.id; user.campusId=null; user.departmentId=null; } if(body.campusId!==undefined){ if(!body.campusId){user.campusId=null;} else { const cp=(store.campuses||[]).find(c=>c.id===body.campusId&&c.institutionId===user.institutionId); if(!cp) return send(res,400,{error:'Choose a campus in this institution.'}); user.campusId=cp.id; } } if(body.departmentId!==undefined){ if(!body.departmentId){user.departmentId=null;} else { const dp=(store.departments||[]).find(d=>d.id===body.departmentId&&d.institutionId===user.institutionId); if(!dp) return send(res,400,{error:'Choose a department in this institution.'}); user.departmentId=dp.id; } } }
    else return send(res,400,{error:'That account action is not allowed.'});
    audit(req.auth,`${action} ${user.role}`,user.email);await persist();send(res,200,{user:publicUser(user)});
  }).catch(e=>send(res,400,{error:e.message}));
  if (req.method === 'GET' && url.pathname === '/api/courses') {
    const q=(url.searchParams.get('q')||'').trim().toLowerCase();
    const level=(url.searchParams.get('level')||'').trim().toLowerCase();
    return send(res,200,{courses:store.courses.filter(c=>(req.auth.role!=='student'||c.status!=='draft')&&(!q||`${c.title} ${c.category} ${c.description}`.toLowerCase().includes(q))&&(!level||level==='all'||String(c.level||'').toLowerCase()===level))});
  }
  if (req.method === 'GET' && /^\/api\/courses\/[^/]+\/reviews$/.test(url.pathname)) {
    const courseId=url.pathname.split('/')[3],course=(store.courses||[]).find(c=>c.id===courseId&&(c.status==='published'||(!c.status&&!c.ownerId)));
    if(!course)return send(res,404,{error:'Published course not found.'});
    const reviews=(store.courseReviews||[]).filter(r=>r.courseId===courseId).map(({id,studentId,studentName,rating,comment,createdAt})=>({id,studentId,studentName,rating,comment,createdAt}));
    return send(res,200,{...courseReviewSummary(courseId),reviews,mine:reviews.find(r=>r.studentId===req.auth.id)||null});
  }
  if (req.method === 'POST' && /^\/api\/courses\/[^/]+\/reviews$/.test(url.pathname)) return readBody(req).then(async body=>{
    if(req.auth.role!=='student')return send(res,403,{error:'Only students can review courses.'});
    const courseId=url.pathname.split('/')[3],course=(store.courses||[]).find(c=>c.id===courseId&&(c.status==='published'||(!c.status&&!c.ownerId)));
    if(!course)return send(res,404,{error:'Published course not found.'});
    if(!(store.enrollments||[]).some(e=>e.studentId===req.auth.id&&e.courseId===courseId))return send(res,403,{error:'Enroll in this course before reviewing it.'});
    const lessons=(course.modules||[]).flatMap(m=>m.lessons||[]),done=new Set(store.courseLessonProgress[`${req.auth.id}:${courseId}`]||[]);
    if(!lessons.length||!lessons.every(l=>done.has(l.id)))return send(res,403,{error:'Complete every course lesson before submitting a review.'});
    const rating=Number(body.rating),comment=String(body.comment||'').trim();
    if(!Number.isInteger(rating)||rating<1||rating>5||comment.length>2000)return send(res,400,{error:'Choose a 1–5 star rating and enter a review of up to 2,000 characters.'});
    const user=store.users.find(u=>u.id===req.auth.id),now=new Date().toISOString();store.courseReviews||=[];
    let review=store.courseReviews.find(r=>r.courseId===courseId&&r.studentId===req.auth.id);
    if(review)Object.assign(review,{rating,comment,updatedAt:now});else{review={id:randomUUID(),courseId,studentId:req.auth.id,studentName:user?.name||'Student',rating,comment,createdAt:now};store.courseReviews.push(review);}
    await persist();return send(res,200,{review,...courseReviewSummary(courseId)});
  }).catch(e=>send(res,400,{error:e.message}));
  if (req.method === 'GET' && url.pathname === '/api/profile') {const user=store.users.find(u=>u.id===req.auth?.id);return send(res,200,{profile:user?publicProfile(user):store.profile});}
  if (req.method === 'GET' && url.pathname === '/api/progress') {const progress=progressForUser(req.auth.id),attempts=(store.userAttempts?.[req.auth.id]||[]).slice(-20).reverse();return send(res,200,{progress,attempts});}
  if (req.method === 'GET' && url.pathname === '/api/vision/progress') {
    const vision=ensureVisionStats(visionForUser(req.auth.id));
    const experiments=vision.experiments||{},xp=Number(vision.xp)||Object.values(experiments).reduce((sum,item)=>sum+(Number(item.xp)||0),0);
    const attempts=Object.values(experiments).reduce((sum,item)=>sum+(Number(item.attempts)||0),0),mistakes=Object.values(experiments).reduce((sum,item)=>sum+(Number(item.mistakes)||0),0);
    return send(res,200,{vision:{completed:vision.completed||{},badges:vision.badges||[],events:(vision.events||[]).slice(-50).reverse(),experiments,xp,attempts,mistakes}});
  }
  if (req.method === 'POST' && url.pathname === '/api/vision/events') return readBody(req).then(async body=>{
    const experimentId=String(body.experimentId||'').slice(0,50),type=body.type;
    if(!/^[a-z0-9-]+$/.test(experimentId)||!['challenge','completed'].includes(type))return send(res,400,{error:'Provide a valid experimentId and event type'});
    const score=Number(body.score??0);if(!Number.isFinite(score)||score<0||score>100)return send(res,400,{error:'score must be between 0 and 100'});
    const vision=ensureVisionStats(visionForUser(req.auth.id)),createdAt=new Date().toISOString();
    if(!vision.experiments)vision.experiments={};
    const allowedSkills=['visual expression','hand control','gesture recognition','spatial tracking','fine motor control','symbol mapping','sequencing','classification','machine learning','scientific reasoning','variables','projectile motion','model interpretation','cell structures','observation','Ohm\'s law','gear ratios','systems thinking','color analysis','equation reasoning','accessible interaction','attention','image processing','computer vision','interaction','visual framing','spatial reasoning','3D manipulation','data structures','decision making','coding','environmental response','explanation','retrieval practice','practice','reflection'];
    const skills=Array.isArray(body.skills)?[...new Set(body.skills.filter(s=>allowedSkills.includes(s)))].slice(0,8):[];
    const recommendedNext=/^[a-z0-9-]{1,50}$/.test(String(body.recommendedNext||''))?String(body.recommendedNext):null;
    const difficulty=['beginner','intermediate','advanced'].includes(body.difficulty)?body.difficulty:'beginner';
    const event={id:randomUUID(),studentId:req.auth.id,experimentId,type,score,skills,recommendedNext,difficulty,mistake:type==='challenge'&&score<60,createdAt};
    vision.events.push(event);if(vision.events.length>500)vision.events=vision.events.slice(-500);
    const firstCompletion=type==='completed'&&!vision.completed[experimentId];
    if(firstCompletion)vision.completed[experimentId]={completedAt:createdAt,score};
    const previous=vision.experiments[experimentId]||{attempts:0,mistakes:0,skills:[],xp:0};
    previous.attempts=(previous.attempts||0)+1;
    if(event.mistake)previous.mistakes=(previous.mistakes||0)+1;
    previous.skills=[...new Set([...(previous.skills||[]),...skills])];
    previous.recommendedNext=recommendedNext||previous.recommendedNext||null;previous.difficulty=difficulty;previous.lastScore=score;previous.lastActivity=createdAt;
    const xpAwarded=firstCompletion?25:type==='challenge'?Math.round(score/20):0;previous.xp=(previous.xp||0)+xpAwarded;vision.experiments[experimentId]=previous;
    vision.xp=Object.values(vision.experiments).reduce((sum,item)=>sum+(Number(item.xp)||0),0);
    const badges={drawing:['sketch-artist','Sketch Artist'], 'air-keyboard':['air-typist','Air Typist'], 'gesture-trainer':['gesture-apprentice','Gesture Apprentice'], 'gesture-deck':['gesture-guide','Gesture Guide'], physics:['physics-explorer','Physics Explorer'], chemistry:['lab-explorer','Lab Explorer'], science:['lab-explorer','Lab Explorer']};
    const award=badges[experimentId];if(type==='completed'&&award&&!vision.badges.some(b=>b.id===award[0]))vision.badges.push({id:award[0],title:award[1],awardedAt:createdAt});
    const completedCount=Object.keys(vision.completed).length;
    if(completedCount>=3&&!vision.badges.some(b=>b.id==='vision-explorer'))vision.badges.push({id:'vision-explorer',title:'Vision Explorer',awardedAt:createdAt});
    await persist();send(res,201,{event,completedCount,badges:vision.badges,xp:vision.xp,xpAwarded,attempts:previous.attempts,mistakes:previous.mistakes});
  }).catch(e=>send(res,400,{error:e.message}));
  if (req.method === 'GET' && url.pathname === '/api/resources') {const q=(url.searchParams.get('q')||'').toLowerCase();const type=(url.searchParams.get('type')||'').toLowerCase();return send(res,200,{resources:(store.resources||[]).filter(r=>(!q||`${r.title} ${r.course} ${r.summary} ${r.type}`.toLowerCase().includes(q))&&(!type||r.type.toLowerCase()===type))});}
  if (req.method === 'GET' && url.pathname.startsWith('/api/resources/')) {const item=(store.resources||[]).find(r=>r.id===url.pathname.split('/')[3]);return item?send(res,200,{resource:item}):send(res,404,{error:'Resource not found'});}
  if(req.auth?.role==='student'&&req.method==='GET'&&url.pathname==='/api/student/analytics'){
    const id=req.auth.id,enrollments=(store.enrollments||[]).filter(e=>e.studentId===id),courses=enrollments.map(e=>{const c=(store.courses||[]).find(x=>x.id===e.courseId);if(!c)return null;const lessons=(c.modules||[]).flatMap(m=>m.lessons||[]),done=new Set(store.courseLessonProgress[`${id}:${c.id}`]||[]);return {courseId:c.id,title:c.title,lessonCount:lessons.length,completedLessons:lessons.filter(l=>done.has(l.id)).length,completion:lessons.length?Math.round(lessons.filter(l=>done.has(l.id)).length/lessons.length*100):0};}).filter(Boolean);
    const assigned=(store.assignments||[]).filter(a=>a.studentIds?.includes(id)),submitted=assigned.filter(a=>a.submissions?.[id]),graded=submitted.map(a=>a.submissions[id]?.grade).filter(g=>g?.releasedAt&&Number.isFinite(Number(g.marks))&&Number(g.maxMarks)>0),activity=store.studentActivity?.[id]||{},secondsByDay=activity.secondsByDay||{},today=studentDay(),weekDays=Array.from({length:7},(_,i)=>{const d=new Date(`${today}T00:00:00Z`);d.setUTCDate(d.getUTCDate()-i);return studentDay(d);}),weekSeconds=weekDays.reduce((n,day)=>n+(Number(secondsByDay[day])||0),0),allSeconds=Object.values(secondsByDay).reduce((n,value)=>n+(Number(value)||0),0);
    const classIds=new Set((store.classes||[]).filter(c=>c.studentIds?.includes(id)).map(c=>c.id)),quizAttempts=Object.values(store.teacherWorkspaces||{}).flatMap(w=>(w.tests||[]).filter(t=>classIds.has(t.classId)).flatMap(t=>(t.attempts||[]).filter(a=>a.studentId===id).map(a=>({title:t.title,submittedAt:a.submittedAt,score:Number.isFinite(Number(a.grade?.score))?Number(a.grade.score):null,feedback:a.grade?.feedback||''}))));
    const assignmentResults=submitted.map(a=>{const submission=a.submissions[id],grade=submission?.grade;return {title:a.title,course:a.course,submittedAt:submission?.submittedAt||null,status:grade?.releasedAt?'graded':'awaiting-review',marks:grade?.releasedAt?grade.marks:null,maxMarks:grade?.releasedAt?grade.maxMarks:null,feedback:grade?.releasedAt?grade.feedback||'':''};}).sort((a,b)=>String(b.submittedAt||'').localeCompare(String(a.submittedAt||'')));
    return send(res,200,{courses,courseCompletion:courses.length?Math.round(courses.reduce((n,c)=>n+c.completion,0)/courses.length):0,learningHours:Math.round(allSeconds/360)/10,weeklyLearningMinutes:Math.floor(weekSeconds/60),streakDays:progressForUser(id).streakDays||0,assignments:{assigned:assigned.length,submitted:submitted.length,graded:graded.length,averagePercent:graded.length?Math.round(graded.reduce((n,g)=>n+Number(g.marks)/Number(g.maxMarks)*100,0)/graded.length):null,results:assignmentResults.slice(0,20)},quizzes:{attempted:quizAttempts.length,scored:quizAttempts.filter(a=>a.score!==null).length,averageScore:quizAttempts.some(a=>a.score!==null)?Math.round(quizAttempts.filter(a=>a.score!==null).reduce((n,a)=>n+a.score,0)/quizAttempts.filter(a=>a.score!==null).length):null,attempts:quizAttempts.sort((a,b)=>String(b.submittedAt).localeCompare(String(a.submittedAt))).slice(0,20)},activityDays:activity.days||[]});
  }
  if(req.method==='POST'&&url.pathname==='/api/student/activity')return readBody(req).then(async body=>{if(req.auth.role!=='student')return send(res,403,{error:'Student access required.'});if(!consumeRate(activityAttempts,req.auth.id,100,60*60*1000))return send(res,429,{error:'Learning activity updates are arriving too often.'});const kind=['course','lesson','quiz','practice','reading','classroom'].includes(body.kind)?body.kind:'learning',activity=store.studentActivity[req.auth.id]||{},now=Date.now(),last=Number(activity.lastTrackedAt)||0,elapsed=last?Math.min(90,Math.max(0,Math.floor((now-last)/1000))):0;activity.lastTrackedAt=now;store.studentActivity[req.auth.id]=activity;if(elapsed>=20){recordStudentActivity(req.auth.id,kind);activity.secondsByDay||={};const day=studentDay();activity.secondsByDay[day]=(Number(activity.secondsByDay[day])||0)+elapsed;const progress=progressForUser(req.auth.id);progress.weeklyMinutes=Math.floor(Object.entries(activity.secondsByDay).filter(([date])=>{const d=new Date(`${day}T00:00:00Z`);d.setUTCDate(d.getUTCDate()-6);return date>=d.toISOString().slice(0,10)&&date<=day;}).reduce((n,[,value])=>n+(Number(value)||0),0)/60);}await persist();return send(res,200,{streakDays:progressForUser(req.auth.id).streakDays||0,trackedSeconds:elapsed});}).catch(e=>send(res,400,{error:e.message}));
  if(req.auth?.role==='student'&&req.method==='GET'&&url.pathname==='/api/community/feed'){
    const community=store.studentCommunity||{posts:[],comments:[],likes:[],bookmarks:[],follows:[]},following=new Set(community.follows.filter(f=>f.followerId===req.auth.id).map(f=>f.followedId)),saved=new Set(community.bookmarks.filter(b=>b.studentId===req.auth.id).map(b=>b.postId)),feed=url.searchParams.get('feed')||'all',q=String(url.searchParams.get('q')||'').trim().toLowerCase();
    let posts=community.posts.filter(p=>!p.hidden&&(!q||`${p.text} ${p.authorName}`.toLowerCase().includes(q))&&(feed!=='following'||following.has(p.authorId))&&(feed!=='bookmarks'||saved.has(p.id)));
    posts=posts.slice(0,100).map(p=>{const author=store.users.find(u=>u.id===p.authorId),comments=community.comments.filter(c=>c.postId===p.id&&!c.hidden).map(c=>({id:c.id,parentId:c.parentId||null,authorId:c.authorId,authorName:store.users.find(u=>u.id===c.authorId)?.name||'Student',text:c.text,createdAt:c.createdAt,liked:community.likes.some(l=>l.studentId===req.auth.id&&l.targetType==='comment'&&l.targetId===c.id),likeCount:community.likes.filter(l=>l.targetType==='comment'&&l.targetId===c.id).length}));return {...p,authorName:author?.name||p.authorName||'Student',liked:community.likes.some(l=>l.studentId===req.auth.id&&l.targetType==='post'&&l.targetId===p.id),bookmarked:saved.has(p.id),likeCount:community.likes.filter(l=>l.targetType==='post'&&l.targetId===p.id).length,following:following.has(p.authorId),followerCount:community.follows.filter(f=>f.followedId===p.authorId).length,comments};});
    return send(res,200,{posts,feed,followingCount:following.size});
  }
  if(req.method==='POST'&&url.pathname==='/api/community/posts')return readBody(req).then(async body=>{if(req.auth.role!=='student')return send(res,403,{error:'Student access required.'});if(!consumeRate(communityAttempts,req.auth.id,30,10*60*1000))return send(res,429,{error:'You are posting too quickly. Try again shortly.'});const text=String(body.text||'').trim();if(text.length<3||text.length>5000)return send(res,400,{error:'Posts must contain 3 to 5,000 characters.'});const user=store.users.find(u=>u.id===req.auth.id),post={id:randomUUID(),authorId:req.auth.id,authorName:user?.name||'Student',text,createdAt:new Date().toISOString(),hidden:false};store.studentCommunity.posts.unshift(post);recordStudentActivity(req.auth.id,'community');await persist();return send(res,201,{post});}).catch(e=>send(res,400,{error:e.message}));
  if(req.method==='POST'&&/^\/api\/community\/posts\/[^/]+\/comments$/.test(url.pathname))return readBody(req).then(async body=>{if(req.auth.role!=='student')return send(res,403,{error:'Student access required.'});if(!consumeRate(communityAttempts,req.auth.id,60,10*60*1000))return send(res,429,{error:'You are commenting too quickly.'});const postId=url.pathname.split('/')[4],community=store.studentCommunity,post=community.posts.find(p=>p.id===postId&&!p.hidden),text=String(body.text||'').trim(),parentId=body.parentId?String(body.parentId):null,parent=parentId&&community.comments.find(c=>c.id===parentId&&c.postId===postId&&!c.hidden);if(!post)return send(res,404,{error:'Discussion not found.'});if(text.length<1||text.length>2000)return send(res,400,{error:'Comments must be 1 to 2,000 characters.'});if(parentId&&!parent)return send(res,400,{error:'Reply to a comment in this discussion.'});const user=store.users.find(u=>u.id===req.auth.id),comment={id:randomUUID(),postId,authorId:req.auth.id,authorName:user?.name||'Student',parentId,text,createdAt:new Date().toISOString(),hidden:false};community.comments.unshift(comment);if(post.authorId!==req.auth.id)createNotification(post.authorId,'community-reply','New discussion reply',`${user?.name||'A student'} commented on your post.`,postId);if(parent&&parent.authorId!==req.auth.id&&parent.authorId!==post.authorId)createNotification(parent.authorId,'community-reply','New reply to your comment',`${user?.name||'A student'} replied to your comment.`,postId);await persist();return send(res,201,{comment});}).catch(e=>send(res,400,{error:e.message}));
  if(req.method==='POST'&&/^\/api\/community\/posts\/[^/]+\/(like|bookmark)$/.test(url.pathname))return readBody(req).then(async body=>{if(req.auth.role!=='student')return send(res,403,{error:'Student access required.'});const parts=url.pathname.split('/'),postId=parts[4],action=parts[5],community=store.studentCommunity;if(!community.posts.some(p=>p.id===postId&&!p.hidden))return send(res,404,{error:'Discussion not found.'});const list=action==='like'?community.likes:community.bookmarks,field=action==='like'?'targetId':'postId',existing=list.findIndex(item=>item.studentId===req.auth.id&&item[field]===postId&&(action!=='like'||item.targetType==='post')),active=typeof body.active==='boolean'?body.active:existing<0;if(active&&existing<0)list.push(action==='like'?{studentId:req.auth.id,targetType:'post',targetId:postId}:{studentId:req.auth.id,postId});if(!active&&existing>=0)list.splice(existing,1);await persist();return send(res,200,{active});}).catch(e=>send(res,400,{error:e.message}));
  if(req.method==='POST'&&/^\/api\/community\/follow\/[^/]+$/.test(url.pathname))return readBody(req).then(async body=>{if(req.auth.role!=='student')return send(res,403,{error:'Student access required.'});const followedId=url.pathname.split('/').at(-1);if(followedId===req.auth.id)return send(res,400,{error:'You cannot follow your own account.'});if(!store.users.some(u=>u.id===followedId&&u.role==='student'&&u.status==='active'))return send(res,404,{error:'Student account not found.'});const rows=store.studentCommunity.follows,index=rows.findIndex(f=>f.followerId===req.auth.id&&f.followedId===followedId),following=typeof body.active==='boolean'?body.active:index<0;if(following&&index<0)rows.push({followerId:req.auth.id,followedId,createdAt:new Date().toISOString()});if(!following&&index>=0)rows.splice(index,1);await persist();return send(res,200,{following});}).catch(e=>send(res,400,{error:e.message}));
  if(req.method==='POST'&&url.pathname==='/api/community/reports')return readBody(req).then(async body=>{if(req.auth.role!=='student')return send(res,403,{error:'Student access required.'});const type=body.targetType==='comment'?'comment':'post',targetId=String(body.targetId||''),community=store.studentCommunity,target=type==='post'?community.posts.find(p=>p.id===targetId):community.comments.find(c=>c.id===targetId),reason=String(body.reason||'').trim();if(!target||target.hidden)return send(res,404,{error:'Content not found.'});if(!['Harassment or bullying','Spam or promotion','Hate or harmful content','Other'].includes(reason))return send(res,400,{error:'Choose a report reason.'});if(community.reports.some(r=>r.reporterId===req.auth.id&&r.targetType===type&&r.targetId===targetId))return send(res,409,{error:'You already reported this content.'});const report={id:randomUUID(),reporterId:req.auth.id,targetType:type,targetId,reason,contentSnapshot:target.text,createdAt:new Date().toISOString(),status:'open'};community.reports.unshift(report);await persist();return send(res,201,{reported:true});}).catch(e=>send(res,400,{error:e.message}));
  if(req.method==='GET'&&url.pathname==='/api/admin/community/reports'){if(!hasPerm('admin','canManageUsers'))return send(res,403,{error:'Content moderation is disabled.'});return send(res,200,{reports:(store.studentCommunity.reports||[]).filter(r=>r.status==='open').slice(0,300).map(r=>({...r,reporterName:store.users.find(u=>u.id===r.reporterId)?.name||'Student'}))});}
  if(req.method==='PATCH'&&/^\/api\/admin\/community\/reports\/[^/]+$/.test(url.pathname))return readBody(req).then(async body=>{if(!hasPerm('admin','canManageUsers'))return send(res,403,{error:'Content moderation is disabled.'});const report=store.studentCommunity.reports.find(r=>r.id===url.pathname.split('/').at(-1));if(!report)return send(res,404,{error:'Report not found.'});if(body.action==='hide'){const rows=report.targetType==='post'?store.studentCommunity.posts:store.studentCommunity.comments,target=rows.find(x=>x.id===report.targetId);if(target){target.hidden=true;target.moderatedAt=new Date().toISOString();target.moderatedBy=req.auth.id;}report.status='actioned';}else if(body.action==='dismiss')report.status='dismissed';else return send(res,400,{error:'Choose hide or dismiss.'});audit(req.auth,`${body.action} community content`,report.targetId);await persist();return send(res,200,{report});}).catch(e=>send(res,400,{error:e.message}));
  if (req.method === 'GET' && url.pathname === '/api/notifications') {const generated=req.auth.role==='student'?ensureStudentReminders(req.auth.id):false,readIds=new Set((store.notificationReads?.[req.auth.id])||[]),classIds=new Set((store.classes||[]).filter(c=>c.studentIds?.includes(req.auth.id)||c.teacherIds?.includes(req.auth.id)).map(c=>c.id)),notifications=(store.notifications||[]).filter(n=>!n.userId||n.userId===req.auth.id||(n.classId&&classIds.has(n.classId))).map(n=>({...n,date:n.date||n.createdAt||'',read:readIds.has(n.id)||!!n.read}));return (generated?persist():Promise.resolve()).then(()=>send(res,200,{notifications}));}
  if (req.method === 'POST' && url.pathname.startsWith('/api/notifications/') && url.pathname.endsWith('/read')) {const item=(store.notifications||[]).find(n=>n.id===url.pathname.split('/')[3]);if(!item)return send(res,404,{error:'Notification not found'});const canSee=!item.userId||item.userId===req.auth.id||(item.classId&&(store.classes||[]).some(c=>c.id===item.classId&&(c.studentIds?.includes(req.auth.id)||c.teacherIds?.includes(req.auth.id))));if(!canSee)return send(res,404,{error:'Notification not found'});store.notificationReads ||= {};store.notificationReads[req.auth.id] ||= [];if(!store.notificationReads[req.auth.id].includes(item.id))store.notificationReads[req.auth.id].push(item.id);return persist().then(()=>send(res,200,{notification:{...item,read:true}}));}

  // ---- Slice D: search, upload, monitoring ----
  if (req.method === 'GET' && url.pathname === '/api/search') {
    const q = url.searchParams.get('q') || '';
    const s = org.orgScope(req.auth);
    const { error, results } = search.search(q, s.institutionId || null);
    if (error) return send(res, 400, { error });
    return send(res, 200, { results });
  }
  if (req.method === 'POST' && url.pathname === '/api/upload') return readBody(req, { maxBytes: MAX_UPLOAD_BODY }).then(async body => {
    // Base64 JSON upload: {filename, mimeType, data, folder}. Teachers/admins only,
    // except students uploading an assignment submission file (folder 'assignments').
    const uploadFolder = String(body.folder || '');
    const studentAssignmentUpload = org.effectiveRole(req.auth.role) === 'student' && uploadFolder === 'assignments';
    if (!studentAssignmentUpload && !['teacher', 'institution_admin', 'super_admin', 'admin'].includes(org.effectiveRole(req.auth.role))) return send(res, 403, { error: 'Upload requires a teacher or admin account.' });
    const mimeType = String(body.mimeType || '');
    const filename = String(body.filename || 'file').slice(0, 120);
    let buffer;
    try { buffer = Buffer.from(String(body.data || ''), 'base64'); } catch { return send(res, 400, { error: 'Invalid base64 data.' }); }
    if (!body.data || buffer.length === 0) return send(res, 400, { error: 'No file data provided.' });
    try {
      const saved = await storage.saveFile({ buffer, mimeType, folder: body.folder, filename });
      audit(req.auth, 'uploaded file', saved.path);
      await persist();
      send(res, 201, { url: saved.url, path: saved.path, provider: saved.provider });
    } catch (e) { send(res, 400, { error: e.message }); }
  }).catch(e => send(res, 400, { error: e.message }));
  if (req.method === 'GET' && url.pathname === '/api/admin/monitoring/errors') {
    if (org.effectiveRole(req.auth.role) !== 'super_admin' && !org.can(req.auth, 'settings.manage')) return send(res, 403, { error: 'Monitoring access is not permitted for your role.' });
    return send(res, 200, { provider: monitor.sentryEnabled() ? 'sentry' : 'local', errors: (store.errorLog || []).slice(0, 100) });
  }
  if (req.method === 'GET' && url.pathname === '/api/teacher/attendance') {const classId=String(url.searchParams.get('classId')||''),date=String(url.searchParams.get('date')||'');if(!/^\d{4}-\d{2}-\d{2}$/.test(date)||Number.isNaN(Date.parse(`${date}T00:00:00Z`))||new Date(`${date}T00:00:00Z`).toISOString().slice(0,10)!==date)return send(res,400,{error:'Choose a valid attendance date.'});const klass=(store.classes||[]).find(c=>c.id===classId&&c.teacherIds.includes(req.auth.id));if(!klass)return send(res,403,{error:'Choose a class assigned to you.'});const students=(klass.studentIds||[]).map(id=>store.users.find(u=>u.id===id&&u.role==='student'&&u.status==='active')).filter(Boolean).map(u=>({id:u.id,name:u.name,registrationNumber:u.registrationNumber||'',rollNumber:u.rollNumber||'',grade:u.grade||'',section:u.section||''}));const record=(teacherWorkspaceFor(req.auth.id).attendance||[]).find(a=>a.classId===classId&&a.date===date);return send(res,200,{class:{id:klass.id,name:klass.name},students,attendance:record?.attendance||[]});}
  if (req.method === 'GET' && url.pathname === '/api/teacher') {
    const memberships=store.classes||[],owned=memberships.filter(c=>c.teacherIds.includes(req.auth.id));
    if(req.auth.role==='student'){
      const activities=memberships.filter(c=>c.studentIds.includes(req.auth.id)),workspaces=Object.values(store.teacherWorkspaces||{});
      const practice=workspaces.flatMap(w=>w.practice||[]).filter(p=>activities.some(c=>c.id===p.classId)).map(({answer,...p})=>p);
      const tests=workspaces.flatMap(w=>w.tests||[]).filter(t=>activities.some(c=>c.id===t.classId)).map(t=>{const {attempts,...test}=t;return {...test,myAttempts:(attempts||[]).filter(a=>a.studentId===req.auth.id).map(a=>({id:a.id,submittedAt:a.submittedAt,grade:a.grade?{score:a.grade.score,feedback:a.grade.feedback}:null}))};});
      const schedule=workspaces.flatMap(w=>w.schedule||[]).filter(item=>activities.some(c=>c.id===item.classId));
      return send(res,200,{teacherData:{schedule,practice,tests},roster:[],classes:activities.map(({studentIds,teacherIds,...c})=>c)});
    }
    const teacherData=teacherWorkspaceFor(req.auth.id),rosterIds=[...new Set(owned.flatMap(c=>c.studentIds))],roster=rosterIds.map(id=>store.users.find(u=>u.id===id)).filter(u=>u&&u.status==='active').map(u=>({id:u.id,name:u.name,role:u.role,status:'present'}));
    return send(res,200,{teacherData,roster,classes:owned.map(c=>({...c,students:c.studentIds.map(id=>store.users.find(u=>u.id===id)).filter(Boolean).map(publicUser)}))});
  }
  if (req.method === 'GET' && url.pathname === '/api/teacher/analytics') {
    const classes=(store.classes||[]).filter(c=>c.teacherIds.includes(req.auth.id)),classIds=new Set(classes.map(c=>c.id)),studentIds=[...new Set(classes.flatMap(c=>c.studentIds||[]))];
    const assignments=(store.assignments||[]).filter(a=>a.teacherId===req.auth.id&&classIds.has(a.classId));
    const submitted=assignments.flatMap(a=>Object.entries(a.submissions||{}).map(([studentId,s])=>({assignmentId:a.id,title:a.title,classId:a.classId,studentId,...s,grade:s.grade||null})));
    const workspace=teacherWorkspaceFor(req.auth.id),attendance=(workspace.attendance||[]).filter(a=>classIds.has(a.classId)).flatMap(a=>a.attendance||[]);
    const studentRecords=studentIds.map(id=>{const user=store.users.find(u=>u.id===id&&u.status==='active');if(!user)return null;const progress=store.userProgress?.[id]||null;const assigned=assignments.filter(a=>a.studentIds?.includes(id));const done=assigned.filter(a=>a.submissions?.[id]).length;return {id:user.id,name:user.name,email:user.email,classes:classes.filter(c=>c.studentIds.includes(id)).map(c=>c.name),assignments:assigned.length,submitted:done,completion:assigned.length?Math.round(done/assigned.length*100):null,progress};}).filter(Boolean);
    return send(res,200,{classes:classes.map(c=>({id:c.id,name:c.name,subject:c.subject,studentCount:(c.studentIds||[]).length})),students:studentRecords,assignments:assignments.map(a=>({id:a.id,title:a.title,classId:a.classId,dueDate:a.dueDate,assignedCount:(a.studentIds||[]).length,submittedCount:Object.keys(a.submissions||{}).length,gradedCount:Object.values(a.submissions||{}).filter(s=>s.grade?.releasedAt).length})),submissions:submitted,attendance:{records:attendance.length,present:attendance.filter(a=>a.status==='present').length,absent:attendance.filter(a=>a.status==='absent').length,late:attendance.filter(a=>a.status==='late').length}});
  }
  if (req.method === 'GET' && url.pathname === '/api/teacher/announcements') {
    if(req.auth.role==='student'){const classIds=new Set((store.classes||[]).filter(c=>c.studentIds.includes(req.auth.id)).map(c=>c.id));const all=Object.values(store.teacherWorkspaces||{}).flatMap(w=>w.announcements||[]).filter(a=>classIds.has(a.classId));return send(res,200,{announcements:all});}
    return send(res,200,{announcements:(store.teacherWorkspaces?.[req.auth.id]?.announcements||[])});
  }
  if (req.method === 'POST' && url.pathname === '/api/teacher/announcements') return readBody(req).then(async body=>{
    const klass=(store.classes||[]).find(c=>c.id===body.classId&&c.teacherIds.includes(req.auth.id));if(!klass)return send(res,403,{error:'Choose a class assigned to you.'});
    const message=String(body.message||'').trim();if(message.length<2||message.length>1500)return send(res,400,{error:'Announcement must contain 2 to 1,500 characters.'});
    const data=teacherWorkspaceFor(req.auth.id);data.announcements||=[];const item={id:randomUUID(),classId:klass.id,className:klass.name,teacherId:req.auth.id,message,createdAt:new Date().toISOString()};data.announcements.unshift(item);notifyClassStudents(klass,'teacher-announcement',`Class announcement · ${klass.name}`,message,item.id);await persist();send(res,201,{announcement:item});
  }).catch(e=>send(res,400,{error:e.message}));
  if (req.method === 'GET' && url.pathname === '/api/teacher/courses') return send(res,200,{courses:(store.courses||[]).filter(c=>c.ownerId===req.auth.id)});
  if (req.method === 'POST' && url.pathname === '/api/teacher/courses') return readBody(req).then(async body=>{
    if(!hasPerm('teacher','canCreateCourses'))return send(res,403,{error:'Course creation is disabled for teachers by the administrator.'});
    const title=String(body.title||'').trim(),description=String(body.description||'').trim();if(title.length<3||title.length>120||description.length>2000)return send(res,400,{error:'Enter a course title and a description of up to 2,000 characters.'});
    const priceCents=body.priceCents===undefined?0:Math.floor(Number(body.priceCents));
    if(!Number.isInteger(priceCents)||priceCents<0||priceCents>100000000)return send(res,400,{error:'Course price must be 0 to 100,000,000 cents.'});
    const currency=/^[A-Z]{3}$/.test(String(body.currency||'INR'))?String(body.currency||'INR'):'INR';
    const splitList=(value,max)=>String(value||'').split('\n').map(v=>v.trim()).filter(Boolean).slice(0,max);const objectives=splitList(body.objectives,20),prerequisites=splitList(body.prerequisites,20),modules=splitList(body.modules,40);
    const myInst=req.auth.institutionId||null;
    const orgErr=body.institutionId!==undefined&&body.institutionId!==myInst?'Courses belong to your institution.':null;
    let campusId=null,departmentId=null,semesterId=null;
    if(body.campusId){const cp=(store.campuses||[]).find(c=>c.id===body.campusId&&c.institutionId===myInst);if(!cp)return send(res,400,{error:'Choose a campus in your institution.'});campusId=cp.id;}
    if(body.departmentId){const dp=(store.departments||[]).find(d=>d.id===body.departmentId&&d.institutionId===myInst&&(!campusId||!dp.campusId||dp.campusId===campusId));if(!dp)return send(res,400,{error:'Choose a department in your institution.'});departmentId=dp.id;}
    if(body.semesterId){const sm=(store.semesters||[]).find(s=>s.id===body.semesterId&&s.institutionId===myInst);if(!sm)return send(res,400,{error:'Choose a semester in your institution.'});semesterId=sm.id;}
    if(orgErr)return send(res,400,{error:orgErr});
    const item={id:randomUUID(),title,category:String(body.category||'Teacher-created').trim().slice(0,80),description,duration:'Self-paced',level:['Beginner','Intermediate','Advanced'].includes(body.level)?body.level:'Beginner',icon:'✦',ownerId:req.auth.id,status:'draft',priceCents,currency,learningObjectives:objectives,prerequisites,modules:modules.map((name,order)=>({id:randomUUID(),name,order})),institutionId:myInst,campusId,departmentId,semesterId,createdAt:new Date().toISOString()};store.courses.unshift(item);await persist();search.scheduleRebuild();send(res,201,{course:item});
  }).catch(e=>send(res,400,{error:e.message}));
  if (req.method === 'PATCH' && /^\/api\/teacher\/courses\/[^/]+$/.test(url.pathname)) return readBody(req).then(async body=>{
    const id=url.pathname.split('/').at(-1),course=(store.courses||[]).find(c=>c.id===id&&c.ownerId===req.auth.id);if(!course)return send(res,404,{error:'Course not found.'});
    if(body.status!==undefined){ if(!['draft','published','archived'].includes(body.status))return send(res,400,{error:'Invalid course status.'}); if(body.status==='published'&&!hasPerm('teacher','canPublishCourses'))return send(res,403,{error:'Course publishing is disabled for teachers by the administrator.'}); if(body.status==='published'&&!course.modules?.length&&!course.description)return send(res,400,{error:'Add a description or module before publishing.'}); course.status=body.status; audit(req.auth,`${body.status} course`,course.title); }
    if(body.title!==undefined){const v=String(body.title).trim();if(v.length<3||v.length>120)return send(res,400,{error:'Course title must be 3 to 120 characters.'});course.title=v;}
    if(body.description!==undefined){const v=String(body.description).trim();if(v.length>2000)return send(res,400,{error:'Description is too long.'});course.description=v;}
    if(body.priceCents!==undefined){const p=Math.floor(Number(body.priceCents));if(!Number.isInteger(p)||p<0||p>100000000)return send(res,400,{error:'Course price must be 0 to 100,000,000 cents.'});course.priceCents=p;}
    if(body.currency!==undefined){if(!/^[A-Z]{3}$/.test(String(body.currency)))return send(res,400,{error:'Currency must be a 3-letter code.'});course.currency=String(body.currency);}
    if(body.objectives!==undefined)course.learningObjectives=String(body.objectives).split('\n').map(v=>v.trim()).filter(Boolean).slice(0,20);
    if(body.prerequisites!==undefined)course.prerequisites=String(body.prerequisites).split('\n').map(v=>v.trim()).filter(Boolean).slice(0,20);
    if(body.modules!==undefined)course.modules=String(body.modules).split('\n').map(v=>v.trim()).filter(Boolean).slice(0,40).map((name,order)=>({id:randomUUID(),name,order}));
    const myInst2=req.auth.institutionId||null;
    if(body.campusId!==undefined){if(!body.campusId)course.campusId=null;else{const cp=(store.campuses||[]).find(c=>c.id===body.campusId&&c.institutionId===myInst2);if(!cp)return send(res,400,{error:'Choose a campus in your institution.'});course.campusId=cp.id;}}
    if(body.departmentId!==undefined){if(!body.departmentId)course.departmentId=null;else{const dp=(store.departments||[]).find(d=>d.id===body.departmentId&&d.institutionId===myInst2);if(!dp)return send(res,400,{error:'Choose a department in your institution.'});course.departmentId=dp.id;}}
    if(body.semesterId!==undefined){if(!body.semesterId)course.semesterId=null;else{const sm=(store.semesters||[]).find(s=>s.id===body.semesterId&&s.institutionId===myInst2);if(!sm)return send(res,400,{error:'Choose a semester in your institution.'});course.semesterId=sm.id;}}
    course.updatedAt=new Date().toISOString();await persist();send(res,200,{course});
  }).catch(e=>send(res,400,{error:e.message}));
  if (req.method === 'GET' && url.pathname === '/api/teacher/grading') {
    const classes=(store.classes||[]).filter(c=>c.teacherIds.includes(req.auth.id)),byId=new Map(classes.map(c=>[c.id,c]));
    const rows=(store.assignments||[]).filter(a=>byId.has(a.classId)&&(a.teacherId===req.auth.id||byId.get(a.classId).teacherIds.includes(req.auth.id))).flatMap(a=>Object.entries(a.submissions||{}).map(([studentId,s])=>({assignmentId:a.id,title:a.title,classId:a.classId,className:byId.get(a.classId)?.name||'',studentId,studentName:store.users.find(u=>u.id===studentId)?.name||'Student',submittedAt:s.submittedAt,text:s.text,fileUrl:s.fileUrl||'',fileName:s.fileName||'',late:!!s.late,rubric:a.rubric||[],grade:s.grade||null})));
    rows.sort((a,b)=>String(b.submittedAt||'').localeCompare(String(a.submittedAt||'')));
    return send(res,200,{submissions:rows});
  }
  if (req.method === 'PATCH' && /^\/api\/teacher\/grading\/[^/]+\/[^/]+$/.test(url.pathname)) return readBody(req).then(async body=>{
    if(!hasPerm('teacher','canGrade'))return send(res,403,{error:'Grading is disabled for teachers by the administrator.'});
    const [, , , , assignmentId,studentId]=url.pathname.split('/');const assignment=(store.assignments||[]).find(a=>a.id===assignmentId&&(store.classes||[]).some(c=>c.id===a.classId&&c.teacherIds.includes(req.auth.id)));
    const submission=assignment?.submissions?.[studentId];if(!submission)return send(res,404,{error:'Submission not found in your assigned classes.'});
    const feedback=String(body.feedback||'').trim();if(feedback.length>3000)return send(res,400,{error:'Feedback is too long.'});
    let marks=Number(body.marks),maxMarks=Number(body.maxMarks||100),rubricScores=null;
    if(body.rubricScores&&typeof body.rubricScores==='object'&&Array.isArray(assignment.rubric)&&assignment.rubric.length){
      let sum=0,cap=0;rubricScores={};
      for(const r of assignment.rubric){const p=Number(body.rubricScores[r.id]);if(!Number.isFinite(p)||p<0||p>r.maxPoints)return send(res,400,{error:`Rubric "${r.criterion}": points must be 0 to ${r.maxPoints}.`});rubricScores[r.id]={points:p,feedback:String((body.rubricScores[r.id+'_feedback']||'')).slice(0,500)};sum+=p;cap+=r.maxPoints;}
      marks=sum;maxMarks=cap;
    }
    if(!Number.isFinite(marks)||!Number.isFinite(maxMarks)||maxMarks<1||maxMarks>10000||marks<0||marks>maxMarks)return send(res,400,{error:'Enter valid marks and feedback.'});
    const wasReleased=!!submission.grade?.releasedAt;submission.grade={marks,maxMarks,feedback,rubricScores,releasedAt:body.release===true?(submission.grade?.releasedAt||new Date().toISOString()):null,updatedAt:new Date().toISOString()};if(body.release===true&&!wasReleased)createNotification(studentId,'assignment-grade','Assignment grade released',`${assignment.title}: ${marks} / ${maxMarks}${feedback?` · ${feedback}`:''}`,assignment.id);await persist();send(res,200,{grade:submission.grade});
  }).catch(e=>send(res,400,{error:e.message}));
  if (req.method === 'POST' && url.pathname.startsWith('/api/teacher/tests/') && url.pathname.endsWith('/attempts')) return readBody(req).then(async body=>{const id=url.pathname.split('/')[4],workspaces=Object.values(store.teacherWorkspaces||{}),test=workspaces.flatMap(w=>w.tests||[]).find(t=>t.id===id&&Array.isArray(t.studentIds)&&t.studentIds.includes(req.auth.id));if(!test)return send(res,404,{error:'Test not found for this student'});test.attempts||=[];const answers=body.answers&&typeof body.answers==='object'&&!Array.isArray(body.answers)?body.answers:{};if(Object.keys(answers).length>50||Object.values(answers).some(a=>typeof a!=='string'||a.length>8000))return send(res,400,{error:'Answers must contain up to 50 text responses (8,000 characters each).'});const attempt={id:randomUUID(),studentId:req.auth.id,answers,submittedAt:new Date().toISOString()};test.attempts.unshift(attempt);createNotification(test.ownerId,'quiz-submission','Quiz submitted',`${store.users.find(u=>u.id===req.auth.id)?.name||'A student'} submitted ${test.title}.`,attempt.id);recordStudentActivity(req.auth.id,'quiz');await persist();send(res,201,{attempt});}).catch(e=>send(res,400,{error:e.message}));
  if(req.method==='PATCH'&&/^\/api\/teacher\/tests\/[^/]+\/attempts\/[^/]+\/grade$/.test(url.pathname))return readBody(req).then(async body=>{if(!hasPerm('teacher','canGrade'))return send(res,403,{error:'Quiz grading is disabled for teachers by the administrator.'});const parts=url.pathname.split('/'),testId=parts[4],attemptId=parts[6],data=teacherWorkspaceFor(req.auth.id),test=data.tests.find(t=>t.id===testId),attempt=test?.attempts?.find(a=>a.id===attemptId);if(!attempt)return send(res,404,{error:'Quiz attempt not found in your workspace.'});const score=Number(body.score),feedback=String(body.feedback||'').trim();if(!Number.isFinite(score)||score<0||score>100||feedback.length>2000)return send(res,400,{error:'Score must be between 0 and 100; feedback may contain up to 2,000 characters.'});attempt.grade={score,feedback,gradedAt:new Date().toISOString(),gradedBy:req.auth.id};createNotification(attempt.studentId,'quiz-result','Quiz score released',`${test.title}: ${score}%${feedback?` · ${feedback}`:''}`,attempt.id);await persist();return send(res,200,{attempt});}).catch(e=>send(res,400,{error:e.message}));

  if (req.method === 'POST' && /^\/api\/teacher\/courses\/[^/]+\/modules$/.test(url.pathname)) return readBody(req).then(async body=>{ const id=url.pathname.split('/')[4],course=(store.courses||[]).find(c=>c.id===id&&c.ownerId===req.auth.id); if(!course) return send(res,404,{error:'Course not found.'}); const name=String(body.name||'').trim(); if(name.length<2||name.length>120) return send(res,400,{error:'Module name must be 2 to 120 characters.'}); course.modules ||= []; const mod={id:randomUUID(),name,order:course.modules.length,lessons:[]}; course.modules.push(mod); await persist(); send(res,201,{module:mod,course}); }).catch(e=>send(res,400,{error:e.message}));

  if (req.method === 'GET' && url.pathname === '/api/teacher/course-progress') { const owned=(store.courses||[]).filter(c=>c.ownerId===req.auth.id); const rows=owned.map(c=>{ const enrolled=(store.enrollments||[]).filter(e=>e.courseId===c.id); const totalLessons=(c.modules||[]).reduce((n,m)=>n+((m.lessons||[]).length||1),0)||1; return {id:c.id,title:c.title,status:c.status||'draft',enrolled:enrolled.length,students:enrolled.map(e=>{ const u=store.users.find(x=>x.id===e.studentId); const done=(store.courseLessonProgress[`${e.studentId}:${c.id}`]||[]).length; return {id:e.studentId,name:u?.name||'Student',completedLessons:done,totalLessons,completion:Math.round(done/totalLessons*100)};})}; }); return send(res,200,{courses:rows}); }
  // ---- Teacher course structure: modules, lessons, resources ----
  if (req.method === 'POST' && /^\/api\/teacher\/courses\/[^/]+\/modules\/[^/]+\/lessons$/.test(url.pathname)) return readBody(req).then(async body=>{ const parts=url.pathname.split('/'),course=(store.courses||[]).find(c=>c.id===parts[4]&&c.ownerId===req.auth.id); const mod=course?.modules?.find(m=>m.id===parts[6]); if(!mod) return send(res,404,{error:'Module not found.'}); const title=String(body.title||'').trim(); if(title.length<2||title.length>160) return send(res,400,{error:'Lesson title must be 2 to 160 characters.'}); const videoCheck=validateVideoUrl(body.videoUrl);if(!videoCheck.ok)return send(res,400,{error:videoCheck.error});
    const videoDurationSec=body.videoDurationSec===undefined?0:Math.floor(Number(body.videoDurationSec));
    if(!Number.isInteger(videoDurationSec)||videoDurationSec<0||videoDurationSec>86400)return send(res,400,{error:'Video duration must be 0 to 86,400 seconds.'});
    const mediaCheck=validateLessonMedia(body,course,req.auth);if(!mediaCheck.ok)return send(res,400,{error:mediaCheck.error});
    const lesson=Object.assign({id:randomUUID(),title,content:String(body.content||'').slice(0,4000),kind:mediaCheck.fields.kind||(videoCheck.value?'video':'reading')},mediaCheck.fields);
    if(videoCheck.value){lesson.videoUrl=videoCheck.value;lesson.videoType=detectVideoType(videoCheck.value);lesson.videoDurationSec=videoDurationSec;}
    mod.lessons ||= []; mod.lessons.push(lesson); await persist(); search.scheduleRebuild(); send(res,201,{lesson}); }).catch(e=>send(res,400,{error:e.message}));

  if (req.method === 'POST' && /^\/api\/courses\/[^/]+\/lessons\/complete$/.test(url.pathname)) return readBody(req).then(async body=>{ const id=url.pathname.split('/')[3],lessonId=String(body.lessonId||'').slice(0,100); if(!lessonId) return send(res,400,{error:'lessonId is required.'}); const key=`${req.auth.id}:${id}`; store.courseLessonProgress[key] ||= []; if(!store.courseLessonProgress[key].includes(lessonId)){store.courseLessonProgress[key].push(lessonId);awardXp(req.auth.id,10,'lesson-complete');awardBadge(req.auth.id,'first-steps');const _c=(store.courses||[]).find(c=>c.id===id),_l=_c?courseAllLessons(_c).find(l=>l.id===lessonId):null;standards.emitXapi({institutionId:(_c&&_c.institutionId)||req.auth.institutionId,user:req.auth,verbKey:'completed',objectId:`eduverse:lesson:${lessonId}`,objectName:_l?_l.title:lessonId,result:{completion:true}});} await persist(); send(res,200,{completed:store.courseLessonProgress[key]}); }).catch(e=>send(res,400,{error:e.message}));  if (req.method === 'POST' && /^\/api\/teacher\/courses\/[^/]+\/resources$/.test(url.pathname)) return readBody(req).then(async body=>{ const id=url.pathname.split('/')[4],course=(store.courses||[]).find(c=>c.id===id&&c.ownerId===req.auth.id); if(!course) return send(res,404,{error:'Course not found.'}); const title=String(body.title||'').trim(),urlValue=String(body.url||'').trim(); if(title.length<2||title.length>160||!(/^https?:\/\//.test(urlValue)||urlValue.startsWith('#'))) return send(res,400,{error:'Provide a resource title and a valid http(s) link.'}); course.resources ||= []; const item={id:randomUUID(),title,type:String(body.type||'link').slice(0,40),url:urlValue}; course.resources.push(item); await persist(); send(res,201,{resource:item}); }).catch(e=>send(res,400,{error:e.message}));

  if (req.method === 'POST' && url.pathname === '/api/teacher/vision-assignments') return readBody(req).then(async body=>{ if(!hasPerm('teacher','canAssignVision')) return send(res,403,{error:'Vision assignments are disabled for teachers by the administrator.'}); const klass=(store.classes||[]).find(c=>c.id===body.classId&&c.teacherIds.includes(req.auth.id)); if(!klass) return send(res,403,{error:'Choose a class assigned to you.'}); const experimentId=String(body.experimentId||'').trim(); if(!/^[a-z0-9-]{2,50}$/.test(experimentId)) return send(res,400,{error:'Choose a vision experiment.'}); const item={id:randomUUID(),teacherId:req.auth.id,classId:klass.id,className:klass.name,experimentId,title:String(body.title||experimentId).slice(0,120),instructions:String(body.instructions||'').slice(0,1500),difficulty:['beginner','intermediate','advanced'].includes(body.difficulty)?body.difficulty:'beginner',dueDate:String(body.dueDate||'').slice(0,20),createdAt:new Date().toISOString()}; store.visionAssignments.unshift(item); await persist(); send(res,201,{assignment:item}); }).catch(e=>send(res,400,{error:e.message}));
  // ================= LMS expansion: quizzes, video, certificates, payments, discussions, live, gamification =================
  const lmsFindQuiz=id=>(store.quizzes||[]).find(q=>q.id===id);
  const lmsQuizOwner=(quiz,user)=>user.role==='admin'||quiz.ownerId===user.id;
  /** Effective questions for an attempt: snapshot taken at start, else the quiz's current list. */
  const attemptQuestions=(attempt,quiz)=>(attempt&&Array.isArray(attempt.questionSnapshot)&&attempt.questionSnapshot.length?attempt.questionSnapshot:(quiz.questions||[]));
  /** Draw the attempt's question list applying randomSelect / difficultyMix over the owner's bank. */
  const buildAttemptQuestions=(quiz,auth)=>{
    const own=(quiz.questions||[]);
    const bank=(store.questionBank||[]).filter(b=>b.ownerId===quiz.ownerId||auth.role==='admin');
    const poolOf=(difficulty,topic)=>bank.filter(b=>(!difficulty||b.difficulty===difficulty)&&(!topic||String(b.topic||'').toLowerCase()===String(topic).toLowerCase()));
    if(quiz.randomSelect&&quiz.randomSelect.count>0){
      const pool=poolOf(quiz.randomSelect.difficulty,quiz.randomSelect.topic);
      const src=pool.length?pool:own.filter(q=>(!quiz.randomSelect.difficulty||q.difficulty===quiz.randomSelect.difficulty)&&(!quiz.randomSelect.topic||String(q.topic||'').toLowerCase()===String(quiz.randomSelect.topic).toLowerCase()));
      const drawn=shuffle(src).slice(0,Math.min(quiz.randomSelect.count,src.length));
      if(drawn.length)return drawn.map(q=>JSON.parse(JSON.stringify(q)));
    }
    if(quiz.difficultyMix&&(quiz.difficultyMix.easy+quiz.difficultyMix.medium+quiz.difficultyMix.hard)>0){
      const out=[];
      for(const d of EXAM_DIFFICULTIES){const need=quiz.difficultyMix[d]||0;if(!need)continue;
        const pool=poolOf(d);const src=pool.length?pool:own.filter(q=>q.difficulty===d);
        out.push(...shuffle(src).slice(0,need));}
      if(out.length)return shuffle(out).map(q=>JSON.parse(JSON.stringify(q)));
    }
    return own.map(q=>JSON.parse(JSON.stringify(q)));
  };
  const ADAPTIVE_ORDER=['easy','medium','hard'];
  const adaptStep=(current,correct)=>{const i=ADAPTIVE_ORDER.indexOf(current);if(i<0)return 'medium';return ADAPTIVE_ORDER[Math.max(0,Math.min(2,i+(correct?1:-1)))];};
  if (req.method === 'POST' && url.pathname === '/api/teacher/quizzes') return readBody(req).then(async body=>{
    const title=String(body.title||'').trim();
    if(title.length<3||title.length>120)return send(res,400,{error:'Quiz title must be 3 to 120 characters.'});
    let rawQuestions=Array.isArray(body.questions)?[...body.questions]:[];
    if(body.bankQuestionIds!==undefined){const cp=copyBankQuestions(body.bankQuestionIds,req.auth);if(!cp.ok)return send(res,400,{error:cp.error});rawQuestions=rawQuestions.concat(cp.questions);}
    const qErr=validateQuizQuestions(rawQuestions);if(qErr)return send(res,400,{error:qErr});
    const cfg=validateQuizConfig(body);if(!cfg.ok)return send(res,400,{error:cfg.error});
    let courseId=null;
    if(body.courseId){const c=(store.courses||[]).find(x=>x.id===body.courseId);if(!c)return send(res,404,{error:'Course not found.'});if(req.auth.role!=='admin'&&c.ownerId!==req.auth.id)return send(res,403,{error:'Choose one of your own courses.'});courseId=c.id;}
    const quiz=Object.assign({id:randomUUID(),courseId,ownerId:req.auth.id,title,description:String(body.description||'').slice(0,2000),
      timeLimitMin:Math.max(0,Math.min(600,Math.floor(Number(body.timeLimitMin)||0))),
      maxAttempts:Math.max(0,Math.min(100,Math.floor(Number(body.maxAttempts)||0))),
      shuffleQuestions:body.shuffleQuestions===true,shuffleOptions:body.shuffleOptions===true,
      passingScore:body.passingScore===undefined?50:Math.max(0,Math.min(100,Math.round(Number(body.passingScore)||0))),
      status:body.status==='published'?'published':'draft',
      isFinalAssessment:body.isFinalAssessment===true&&!!courseId,
      questions:rawQuestions.map(normalizeQuestion),createdAt:new Date().toISOString(),updatedAt:new Date().toISOString()},defaultQuizConfig(),cfg.config);
    if(quiz.isFinalAssessment)for(const q of (store.quizzes||[]))if(q.id!==quiz.id&&q.courseId===courseId)q.isFinalAssessment=false;
    store.quizzes.unshift(quiz);await persist();search.scheduleRebuild();send(res,201,{quiz});
  }).catch(e=>send(res,400,{error:e.message}));
  if (req.method === 'GET' && url.pathname === '/api/teacher/quizzes') return send(res,200,{quizzes:(store.quizzes||[]).filter(q=>lmsQuizOwner(q,req.auth))});
  if (req.method === 'GET' && /^\/api\/teacher\/quizzes\/[^/]+\/attempts$/.test(url.pathname)) {const quiz=lmsFindQuiz(url.pathname.split('/')[4]);if(!quiz||!lmsQuizOwner(quiz,req.auth))return send(res,404,{error:'Quiz not found.'});const attempts=(store.quizAttempts||[]).filter(a=>a.quizId===quiz.id).map(a=>({...a,studentName:store.users.find(u=>u.id===a.studentId)?.name||'Student'}));return send(res,200,{quiz,attempts});}
  if (req.method === 'GET' && /^\/api\/teacher\/quizzes\/[^/]+$/.test(url.pathname)) {const quiz=lmsFindQuiz(url.pathname.split('/')[4]);if(!quiz||!lmsQuizOwner(quiz,req.auth))return send(res,404,{error:'Quiz not found.'});return send(res,200,{quiz});}
  if (req.method === 'PATCH' && /^\/api\/teacher\/quizzes\/[^/]+$/.test(url.pathname)) return readBody(req).then(async body=>{
    const quiz=lmsFindQuiz(url.pathname.split('/')[4]);if(!quiz||!lmsQuizOwner(quiz,req.auth))return send(res,404,{error:'Quiz not found.'});
    if(body.title!==undefined){const t=String(body.title).trim();if(t.length<3||t.length>120)return send(res,400,{error:'Quiz title must be 3 to 120 characters.'});quiz.title=t;}
    if(body.description!==undefined)quiz.description=String(body.description).slice(0,2000);
    if(body.timeLimitMin!==undefined)quiz.timeLimitMin=Math.max(0,Math.min(600,Math.floor(Number(body.timeLimitMin)||0)));
    if(body.maxAttempts!==undefined)quiz.maxAttempts=Math.max(0,Math.min(100,Math.floor(Number(body.maxAttempts)||0)));
    if(body.shuffleQuestions!==undefined)quiz.shuffleQuestions=body.shuffleQuestions===true;
    if(body.shuffleOptions!==undefined)quiz.shuffleOptions=body.shuffleOptions===true;
    if(body.passingScore!==undefined)quiz.passingScore=Math.max(0,Math.min(100,Math.round(Number(body.passingScore)||0)));
    if(body.status!==undefined){if(!['draft','published'].includes(body.status))return send(res,400,{error:'Quiz status must be draft or published.'});quiz.status=body.status;}
    if(body.questions!==undefined){const qErr=validateQuizQuestions(body.questions);if(qErr)return send(res,400,{error:qErr});quiz.questions=body.questions.map(normalizeQuestion);}
    if(body.courseId!==undefined){if(!body.courseId)quiz.courseId=null;else{const c=(store.courses||[]).find(x=>x.id===body.courseId);if(!c)return send(res,404,{error:'Course not found.'});if(req.auth.role!=='admin'&&c.ownerId!==req.auth.id)return send(res,403,{error:'Choose one of your own courses.'});quiz.courseId=c.id;}}
    if(body.isFinalAssessment!==undefined){quiz.isFinalAssessment=body.isFinalAssessment===true&&!!quiz.courseId;if(quiz.isFinalAssessment)for(const q of (store.quizzes||[]))if(q.id!==quiz.id&&q.courseId===quiz.courseId)q.isFinalAssessment=false;}
    if(body.bankQuestionIds!==undefined){const cp=copyBankQuestions(body.bankQuestionIds,req.auth);if(!cp.ok)return send(res,400,{error:cp.error});
      const merged=(quiz.questions||[]).concat(cp.questions.map(normalizeQuestion));if(merged.length>100)return send(res,400,{error:'A quiz can have at most 100 questions.'});quiz.questions=merged;}
    const cfg=validateQuizConfig(body);if(!cfg.ok)return send(res,400,{error:cfg.error});
    Object.assign(quiz,cfg.config);
    quiz.updatedAt=new Date().toISOString();await persist();send(res,200,{quiz});
  }).catch(e=>send(res,400,{error:e.message}));
  if (req.method === 'DELETE' && /^\/api\/teacher\/quizzes\/[^/]+$/.test(url.pathname)) {const id=url.pathname.split('/')[4],idx=(store.quizzes||[]).findIndex(q=>q.id===id);const quiz=store.quizzes[idx];if(idx<0||!lmsQuizOwner(quiz,req.auth))return send(res,404,{error:'Quiz not found.'});store.quizzes.splice(idx,1);store.quizAttempts=(store.quizAttempts||[]).filter(a=>a.quizId!==id);return persist().then(()=>send(res,200,{deleted:true}));}
  // ---- Question bank ----
  const bankVisible=b=>req.auth.role==='admin'||b.ownerId===req.auth.id;
  if (req.method === 'GET' && url.pathname === '/api/teacher/question-bank') {
    const topic=(url.searchParams.get('topic')||'').trim().toLowerCase(),difficulty=url.searchParams.get('difficulty')||'',type=url.searchParams.get('type')||'';
    const list=(store.questionBank||[]).filter(b=>bankVisible(b)&&(!topic||String(b.topic||'').toLowerCase().includes(topic))&&(!difficulty||b.difficulty===difficulty)&&(!type||b.type===type));
    return send(res,200,{questions:list});
  }
  if (req.method === 'POST' && url.pathname === '/api/teacher/question-bank') return readBody(req).then(async body=>{
    const err=validateExamQuestion(body||{},0);if(err)return send(res,400,{error:err.replace(/^Question 1/,'Question')});
    const q=normalizeQuestion(body);const entry=Object.assign({ownerId:req.auth.id,tags:Array.isArray(body.tags)?body.tags.map(t=>String(t).trim().slice(0,40)).filter(Boolean).slice(0,10):[],createdAt:new Date().toISOString(),updatedAt:new Date().toISOString()},q);
    store.questionBank.unshift(entry);await persist();send(res,201,{question:entry});
  }).catch(e=>send(res,400,{error:e.message}));
  if (req.method === 'PATCH' && /^\/api\/teacher\/question-bank\/[^/]+$/.test(url.pathname)) return readBody(req).then(async body=>{
    const b=(store.questionBank||[]).find(x=>x.id===url.pathname.split('/')[4]);if(!b||!bankVisible(b))return send(res,404,{error:'Question not found.'});
    const merged=Object.assign({},b,body,{id:b.id,ownerId:b.ownerId});
    const err=validateExamQuestion(merged,0);if(err)return send(res,400,{error:err.replace(/^Question 1/,'Question')});
    const nq=normalizeQuestion(merged);nq.id=b.id;
    Object.assign(b,nq,{tags:Array.isArray(body.tags)?body.tags.map(t=>String(t).trim().slice(0,40)).filter(Boolean).slice(0,10):b.tags,updatedAt:new Date().toISOString()});
    await persist();send(res,200,{question:b});
  }).catch(e=>send(res,400,{error:e.message}));
  if (req.method === 'DELETE' && /^\/api\/teacher\/question-bank\/[^/]+$/.test(url.pathname)) {const id=url.pathname.split('/')[4],idx=(store.questionBank||[]).findIndex(x=>x.id===id);const b=store.questionBank[idx];if(idx<0||!bankVisible(b))return send(res,404,{error:'Question not found.'});store.questionBank.splice(idx,1);return persist().then(()=>send(res,200,{deleted:true}));}
  if (req.method === 'GET' && url.pathname === '/api/quizzes') {
    const enrolled=new Set((store.enrollments||[]).filter(e=>e.studentId===req.auth.id).map(e=>e.courseId));
    const list=req.auth.role==='student'?(store.quizzes||[]).filter(q=>q.status==='published'&&(!q.courseId||enrolled.has(q.courseId))&&!(q.practice&&q.ownerId!==req.auth.id)):(store.quizzes||[]);
    const quizzes=list.map(q=>{const mine=(store.quizAttempts||[]).filter(a=>a.quizId===q.id&&a.studentId===req.auth.id);const graded=mine.filter(a=>a.status==='graded');
      return {...stripQuizForStudent(q),attemptsUsed:mine.length,attemptsLeft:(q.maxAttempts||0)>0?Math.max(0,q.maxAttempts-mine.length):null,bestScore:graded.length?Math.max(...graded.map(a=>a.finalScore||0)):null};});
    return send(res,200,{quizzes});
  }
  if (req.method === 'GET' && /^\/api\/quizzes\/[^/]+$/.test(url.pathname)) {
    const quiz=lmsFindQuiz(url.pathname.split('/')[3]);if(!quiz)return send(res,404,{error:'Quiz not found.'});
    if(req.auth.role==='student'){
      if(quiz.practice&&quiz.ownerId!==req.auth.id)return send(res,403,{error:'This practice quiz belongs to another student.'});
      if(quiz.status!=='published')return send(res,403,{error:'This quiz is not available yet.'});
      if(quiz.courseId&&!(store.enrollments||[]).some(e=>e.studentId===req.auth.id&&e.courseId===quiz.courseId))return send(res,403,{error:'Enroll in this course to view the quiz.'});
    }
    const view=stripQuizForStudent(quiz);
    if(quiz.shuffleQuestions&&req.auth.role==='student')view.questions=shuffle(view.questions);
    return send(res,200,{quiz:view});
  }
  if (req.method === 'POST' && /^\/api\/quizzes\/[^/]+\/start$/.test(url.pathname)) return readBody(req).then(async body=>{
    const quiz=lmsFindQuiz(url.pathname.split('/')[3]);if(!quiz)return send(res,404,{error:'Quiz not found.'});
    if(req.auth.role==='student'){
      if(quiz.practice&&quiz.ownerId!==req.auth.id)return send(res,403,{error:'This practice quiz belongs to another student.'});
      if(quiz.status!=='published')return send(res,403,{error:'This quiz is not available yet.'});
      if(quiz.courseId&&!(store.enrollments||[]).some(e=>e.studentId===req.auth.id&&e.courseId===quiz.courseId))return send(res,403,{error:'Enroll in this course to take the quiz.'});
    }
    if(quiz.proctoring&&quiz.proctoring.enabled&&body.proctorConsent!==true&&req.auth.role==='student')
      return send(res,403,{error:'This is a proctored exam. Please accept the proctoring consent to begin.',proctorConsentRequired:true,
        proctoring:{what:'Periodic webcam snapshots (small stills you can see) and a tab-switch count.',where:'Attached to your attempt, visible only to your teacher for review.',snapshotIntervalSec:quiz.proctoring.snapshotIntervalSec||60}});
    const prior=(store.quizAttempts||[]).filter(a=>a.quizId===quiz.id&&a.studentId===req.auth.id);
    const live=prior.find(a=>a.status==='in-progress');
    const serverNow=Date.now();
    const expiresAt=(quiz.timeLimitMin||0)>0?new Date(serverNow+quiz.timeLimitMin*60000).toISOString():null;
    if(live){const lq=attemptQuestions(live,quiz);
      return send(res,200,{attemptId:live.id,startedAt:live.startedAt,serverNow,expiresAt,timeLimitMin:quiz.timeLimitMin||0,questionCount:lq.length,questions:attemptDisplayQuestions(quiz,live),resumed:true,adaptive:!!live.adaptive,currentDifficulty:live.adaptiveState&&live.adaptiveState.current});}
    if((quiz.maxAttempts||0)>0&&prior.length>=quiz.maxAttempts)return send(res,403,{error:'You have used all attempts for this quiz.'});
    const effective=buildAttemptQuestions(quiz,req.auth);
    if(!effective.length)return send(res,400,{error:'This quiz has no questions to draw from.'});
    if(quiz.adaptive){
      const attempt={id:randomUUID(),quizId:quiz.id,studentId:req.auth.id,startedAt:new Date().toISOString(),submittedAt:null,answers:{},autoScore:null,manualScore:null,finalScore:null,passed:false,status:'in-progress',questionGrades:{},questionOrder:[],optionOrder:{},matchOrder:{},adaptive:true,
        adaptiveState:{current:'medium',askedIds:[],path:['medium']},questionSnapshot:effective,
        tabSwitches:[],proctor:quiz.proctoring&&quiz.proctoring.enabled?{consentedAt:new Date().toISOString(),snapshots:[]}:null,
        autoSubmitted:false,perQuestionSec:{},attemptNumber:prior.length+1,late:false,passXpAwarded:false};
      store.quizAttempts.unshift(attempt);await persist();
      return send(res,201,{attemptId:attempt.id,startedAt:attempt.startedAt,serverNow,expiresAt,timeLimitMin:quiz.timeLimitMin||0,adaptive:true,currentDifficulty:'medium'});
    }
    const questionOrder=quiz.shuffleQuestions?shuffle(effective.map(q=>q.id)):effective.map(q=>q.id);
    const optionOrder={};for(const q of effective)if((q.type==='mcq'||q.type==='multiselect')&&quiz.shuffleOptions)optionOrder[q.id]=shuffle(q.options.map((_,i)=>i));
    const attempt={id:randomUUID(),quizId:quiz.id,studentId:req.auth.id,startedAt:new Date().toISOString(),submittedAt:null,answers:{},autoScore:null,manualScore:null,finalScore:null,passed:false,status:'in-progress',questionGrades:{},questionOrder,optionOrder,matchOrder:{},adaptive:false,
      questionSnapshot:effective,tabSwitches:[],proctor:quiz.proctoring&&quiz.proctoring.enabled?{consentedAt:new Date().toISOString(),snapshots:[]}:null,
      autoSubmitted:false,perQuestionSec:{},attemptNumber:prior.length+1,late:false,passXpAwarded:false};
    store.quizAttempts.unshift(attempt);await persist();
    send(res,201,{attemptId:attempt.id,startedAt:attempt.startedAt,serverNow,expiresAt,timeLimitMin:quiz.timeLimitMin||0,questionCount:effective.length,questions:attemptDisplayQuestions(quiz,attempt)});
  }).catch(e=>send(res,400,{error:e.message}));
  if (req.method === 'POST' && /^\/api\/quizzes\/[^/]+\/attempts\/[^/]+\/submit$/.test(url.pathname)) return readBody(req).then(async body=>{
    const parts=url.pathname.split('/'),quiz=lmsFindQuiz(parts[3]);
    const attempt=(store.quizAttempts||[]).find(a=>a.id===parts[5]&&a.quizId===parts[3]);
    if(!quiz||!attempt)return send(res,404,{error:'Quiz attempt not found.'});
    if(attempt.studentId!==req.auth.id&&req.auth.role!=='admin')return send(res,403,{error:'This attempt belongs to another student.'});
    if(attempt.status!=='in-progress')return send(res,400,{error:'This attempt was already submitted.'});
    const raw=(body.answers&&typeof body.answers==='object'&&!Array.isArray(body.answers))?body.answers:{};
    const qs=attemptQuestions(attempt,quiz);
    const neg=Number(quiz.negativeMarking)||0;
    const answers=attempt.adaptive?Object.assign({},attempt.answers):{};
    // client-reported telemetry (validated, capped)
    if(body.perQuestionSec&&typeof body.perQuestionSec==='object'){for(const [k,v] of Object.entries(body.perQuestionSec)){const s=Math.floor(Number(v));if(Number.isInteger(s)&&s>=0&&s<=86400)attempt.perQuestionSec[k.slice(0,100)]=s;}}
    if(Array.isArray(body.tabSwitches)){attempt.tabSwitches=body.tabSwitches.slice(0,100).map(t=>({at:String((t&&t.at)||'').slice(0,30)||new Date().toISOString()}));}
    if(body.proctor&&typeof body.proctor==='object'&&attempt.proctor&&attempt.proctor.consentedAt){
      const snaps=attempt.proctor.snapshots||[];
      for(const s of (body.proctor.snapshots||[]).slice(0,Math.max(0,20-snaps.length))){
        const dataUrl=String((s&&s.img)||(s&&s.dataUrl)||'');
        if(/^data:image\/(jpeg|png);base64,/.test(dataUrl)&&dataUrl.length<=300000)snaps.push({at:String((s&&s.at)||'').slice(0,30)||new Date().toISOString(),dataUrl});
      }
      attempt.proctor.snapshots=snaps;
    }
    attempt.submittedAt=new Date().toISOString();
    if(isAttemptExpired(quiz,attempt)){attempt.autoSubmitted=true;attempt.late=true;}
    else if((quiz.timeLimitMin||0)>0&&(Date.now()-new Date(attempt.startedAt).getTime())>quiz.timeLimitMin*60000)attempt.late=true;
    let total=0,earned=0,needsManual=false;attempt.questionGrades=attempt.questionGrades||{};
    for(const q of qs){
      if(attempt.adaptive&&!(attempt.adaptiveState&&attempt.adaptiveState.askedIds||[]).includes(q.id))continue;
      total+=q.points;
      if(attempt.adaptive&&attempt.questionGrades[q.id]!==undefined){earned+=attempt.questionGrades[q.id].points||0;if(attempt.questionGrades[q.id].needsManual)needsManual=true;continue;}
      const ans=sanitizeExamAnswer(q,raw[q.id]);answers[q.id]=ans;
      let e=0,feedback='',codeResults=null;
      if(q.type==='short'||q.type==='essay')needsManual=true;
      else if(q.type==='code'){
        if(q.language==='javascript'){const run=runCodeTests(ans,q.testCases);e=run.total>0?q.points*run.earned/run.total:0;codeResults=run.results;}
        else needsManual=true;
      }
      else e=gradeObjective(q,ans,attempt.optionOrder&&attempt.optionOrder[q.id]);
      if(neg>0&&EXAM_OBJECTIVE_TYPES.includes(q.type)&&isObjectiveAttempted(q,ans)&&e===0)e=-neg*q.points;
      e=Math.round(e*100)/100;earned+=e;
      attempt.questionGrades[q.id]={points:e,feedback,codeResults,needsManual:needsManual&&(q.type==='short'||q.type==='essay'||q.type==='code')};
    }
    attempt.answers=answers;
    const floored=Math.max(0,earned);
    attempt.autoScore=total?Math.round(floored/total*100):0;attempt.manualScore=null;attempt.finalScore=attempt.autoScore;
    if(needsManual){attempt.status='submitted';attempt.passed=false;}
    else{attempt.status='graded';attempt.passed=attempt.finalScore>=(quiz.passingScore??50);
      if(attempt.passed){attempt.passXpAwarded=true;awardXp(attempt.studentId,50,'quiz-passed');}
      if(attempt.finalScore>=90)awardBadge(attempt.studentId,'quiz-master');
      notify.quizGraded(attempt.studentId, quiz.title, `${attempt.finalScore}%`).catch(()=>{});
      {const _u=store.users.find(u=>u.id===attempt.studentId),_qc=(store.courses||[]).find(c=>c.id===quiz.courseId);standards.emitXapi({institutionId:(_qc&&_qc.institutionId)||(_u&&_u.institutionId),user:_u,verbKey:attempt.passed?'passed':'failed',verbDisplay:attempt.passed?'passed':'failed',objectId:`eduverse:quiz:${quiz.id}`,objectName:quiz.title,result:{score:{raw:attempt.finalScore,min:0,max:100},success:attempt.passed,completion:true}});}}
    awardXp(attempt.studentId,10,'quiz-taken');
    await persist();send(res,200,{attempt:stripAttemptForStudent(attempt)});
  }).catch(e=>send(res,400,{error:e.message}));
  if (req.method === 'GET' && /^\/api\/quizzes\/[^/]+\/my-attempts$/.test(url.pathname)) {const id=url.pathname.split('/')[3];return send(res,200,{attempts:(store.quizAttempts||[]).filter(a=>a.quizId===id&&a.studentId===req.auth.id).map(stripAttemptForStudent)});}
  // ---- Detailed solutions (policy-gated) ----
  if (req.method === 'GET' && /^\/api\/quizzes\/[^/]+\/attempts\/[^/]+\/solutions$/.test(url.pathname)) return readBody(req).then(async body=>{
    const parts=url.pathname.split('/'),quiz=lmsFindQuiz(parts[3]);
    const attempt=(store.quizAttempts||[]).find(a=>a.id===parts[5]&&a.quizId===parts[3]);
    if(!quiz||!attempt)return send(res,404,{error:'Quiz attempt not found.'});
    if(attempt.studentId!==req.auth.id&&req.auth.role!=='admin')return send(res,403,{error:'This attempt belongs to another student.'});
    if(attempt.status==='in-progress')return send(res,400,{error:'Submit the attempt first.'});
    const policy=['immediate','after_pass','never'].includes(quiz.showSolutions)?quiz.showSolutions:'after_pass';
    if(policy==='never')return send(res,403,{error:'Solutions are not shared for this quiz.'});
    if(policy==='after_pass'&&!attempt.passed)return send(res,403,{error:'Solutions unlock after you pass this quiz.'});
    const qs=attemptQuestions(attempt,quiz);
    const solutions=qs.map(q=>{const g=attempt.questionGrades&&attempt.questionGrades[q.id];
      const earned=g?g.points||0:0;
      const sol={questionId:q.id,type:q.type,prompt:q.prompt,points:q.points,earnedPoints:earned,
        correct:earned>=q.points,explanation:q.explanation||'',feedback:(g&&g.feedback)||''};
      if(q.type==='mcq')sol.correctOption=q.correctIndex;
      if(q.type==='truefalse')sol.correctBoolean=q.correctBoolean;
      if(q.type==='multiselect')sol.correctIndices=q.correctIndices;
      if(q.type==='fillblank')sol.blankAnswers=q.blankAnswers;
      if(q.type==='match')sol.pairs=q.pairs.map(p=>({left:p.left,right:p.right}));
      if(q.type==='code'&&g&&g.codeResults)sol.codeResults=g.codeResults;
      return sol;});
    return send(res,200,{solutions,finalScore:attempt.finalScore,passed:attempt.passed});
  }).catch(e=>send(res,400,{error:e.message}));
  // ---- Exam analytics (teacher) ----
  if (req.method === 'GET' && /^\/api\/teacher\/quizzes\/[^/]+\/analytics$/.test(url.pathname)) {
    const quiz=lmsFindQuiz(url.pathname.split('/')[4]);if(!quiz||!lmsQuizOwner(quiz,req.auth))return send(res,404,{error:'Quiz not found.'});
    const attempts=(store.quizAttempts||[]).filter(a=>a.quizId===quiz.id&&a.status!=='in-progress');
    const scores=attempts.map(a=>Number(a.finalScore)||0);
    const avgScore=scores.length?Math.round(scores.reduce((s,x)=>s+x,0)/scores.length):0;
    const passRate=attempts.length?Math.round(attempts.filter(a=>a.passed).length/attempts.length*100):0;
    const buckets=Array(10).fill(0);for(const s of scores)buckets[Math.min(9,Math.floor(s/10))]++;
    const durations=attempts.filter(a=>a.startedAt&&a.submittedAt).map(a=>(new Date(a.submittedAt).getTime()-new Date(a.startedAt).getTime())/1000).filter(x=>x>=0);
    const avgDurationSec=durations.length?Math.round(durations.reduce((s,x)=>s+x,0)/durations.length):0;
    const perQuestion=(quiz.questions||[]).map(q=>{
      const rel=attempts.filter(a=>a.questionGrades&&a.questionGrades[q.id]!==undefined);
      const earned=rel.map(a=>Number(a.questionGrades[q.id].points)||0);
      const avg=earned.length?earned.reduce((s,x)=>s+x,0)/earned.length:0;
      const secs=rel.map(a=>Number(a.perQuestionSec&&a.perQuestionSec[q.id])||0).filter(x=>x>0);
      return {questionId:q.id,prompt:q.prompt,type:q.type,difficulty:q.difficulty||'medium',topic:q.topic||'',
        attempts:rel.length,correctRate:q.points?Math.round(avg/q.points*100):0,
        avgPoints:Math.round(avg*100)/100,avgSec:secs.length?Math.round(secs.reduce((s,x)=>s+x,0)/secs.length):0,
        tabSwitches:attempts.reduce((s,a)=>s+((a.tabSwitches||[]).length),0)};
    });
    return send(res,200,{quizId:quiz.id,title:quiz.title,attempts:attempts.length,avgScore,passRate,
      scoreDistribution:buckets,avgDurationSec,perQuestion,
      proctored:attempts.filter(a=>a.proctor&&a.proctor.consentedAt).length,
      autoSubmitted:attempts.filter(a=>a.autoSubmitted).length});
  }
  // ---- Adaptive exam flow: one question at a time ----
  function adaptiveNextQuestion(quiz,attempt){
    const pool=attemptQuestions(attempt,quiz),asked=new Set((attempt.adaptiveState&&attempt.adaptiveState.askedIds)||[]);
    const target=attempt.adaptiveState&&attempt.adaptiveState.current||'medium';
    let cands=pool.filter(q=>!asked.has(q.id)&&q.difficulty===target);
    if(!cands.length)cands=pool.filter(q=>!asked.has(q.id));
    if(!cands.length)return null;
    return cands[Math.floor(Math.random()*cands.length)];
  }
  if (req.method === 'GET' && /^\/api\/quizzes\/[^/]+\/attempts\/[^/]+\/next$/.test(url.pathname)) return readBody(req).then(async body=>{
    const parts=url.pathname.split('/'),quiz=lmsFindQuiz(parts[3]);
    const attempt=(store.quizAttempts||[]).find(a=>a.id===parts[5]&&a.quizId===parts[3]);
    if(!quiz||!attempt)return send(res,404,{error:'Quiz attempt not found.'});
    if(attempt.studentId!==req.auth.id&&req.auth.role!=='admin')return send(res,403,{error:'This attempt belongs to another student.'});
    if(!attempt.adaptive)return send(res,400,{error:'This quiz does not use adaptive mode.'});
    if(attempt.status!=='in-progress')return send(res,400,{error:'This attempt is no longer in progress.'});
    const q=adaptiveNextQuestion(quiz,attempt);
    if(!q)return send(res,200,{done:true});
    if((q.type==='mcq'||q.type==='multiselect')&&quiz.shuffleOptions&&!(attempt.optionOrder&&attempt.optionOrder[q.id])){
      attempt.optionOrder=attempt.optionOrder||{};attempt.optionOrder[q.id]=shuffle(q.options.map((_,i)=>i));await persist();}
    const out=publicQuestion(q),oo=attempt.optionOrder&&attempt.optionOrder[q.id];
    if(Array.isArray(oo)&&out.options)out.options=oo.map(i=>out.options[i]);
    const remaining=attemptQuestions(attempt,quiz).length-((attempt.adaptiveState&&attempt.adaptiveState.askedIds)||[]).length;
    return send(res,200,{question:out,currentDifficulty:attempt.adaptiveState.current,remaining,
      serverNow:Date.now(),expiresAt:(quiz.timeLimitMin||0)>0?new Date(new Date(attempt.startedAt).getTime()+quiz.timeLimitMin*60000).toISOString():null});
  }).catch(e=>send(res,400,{error:e.message}));
  if (req.method === 'POST' && /^\/api\/quizzes\/[^/]+\/attempts\/[^/]+\/answer$/.test(url.pathname)) return readBody(req).then(async body=>{
    const parts=url.pathname.split('/'),quiz=lmsFindQuiz(parts[3]);
    const attempt=(store.quizAttempts||[]).find(a=>a.id===parts[5]&&a.quizId===parts[3]);
    if(!quiz||!attempt)return send(res,404,{error:'Quiz attempt not found.'});
    if(attempt.studentId!==req.auth.id)return send(res,403,{error:'This attempt belongs to another student.'});
    if(!attempt.adaptive)return send(res,400,{error:'This quiz does not use adaptive mode.'});
    if(attempt.status!=='in-progress')return send(res,400,{error:'This attempt is no longer in progress.'});
    if(isAttemptExpired(quiz,attempt))return send(res,400,{error:'Time is up. Submit your attempt.',expired:true});
    const q=attemptQuestions(attempt,quiz).find(x=>x.id===String(body.questionId));
    if(!q)return send(res,404,{error:'Question not found in this attempt.'});
    if((attempt.adaptiveState.askedIds||[]).includes(q.id))return send(res,400,{error:'This question was already answered.'});
    const ans=sanitizeExamAnswer(q,body.answer);
    attempt.answers[q.id]=ans;
    const sec=Math.max(0,Math.min(86400,Math.floor(Number(body.secSpent)||0)));
    attempt.perQuestionSec[q.id]=sec;
    let e=0,codeResults=null,needsManual=false;
    if(q.type==='short'||q.type==='essay')needsManual=true;
    else if(q.type==='code'&&q.language==='javascript'){const run=runCodeTests(ans,q.testCases);e=run.total>0?q.points*run.earned/run.total:0;codeResults=run.results;}
    else if(q.type==='code')needsManual=true;
    else e=gradeObjective(q,ans,attempt.optionOrder&&attempt.optionOrder[q.id]);
    const neg=Number(quiz.negativeMarking)||0;
    if(neg>0&&EXAM_OBJECTIVE_TYPES.includes(q.type)&&isObjectiveAttempted(q,ans)&&e===0)e=-neg*q.points;
    attempt.questionGrades[q.id]={points:Math.round(e*100)/100,feedback:'',codeResults,needsManual};
    attempt.adaptiveState.askedIds.push(q.id);
    if(!needsManual)attempt.adaptiveState.current=adaptStep(attempt.adaptiveState.current,e>=q.points/2);
    attempt.adaptiveState.path.push(attempt.adaptiveState.current);
    await persist();
    const next=adaptiveNextQuestion(quiz,attempt);
    send(res,200,{recorded:true,currentDifficulty:attempt.adaptiveState.current,done:!next});
  }).catch(e=>send(res,400,{error:e.message}));
  if (req.method === 'POST' && /^\/api\/quizzes\/[^/]+\/attempts\/[^/]+\/snapshots$/.test(url.pathname)) return readBody(req).then(async body=>{
    const parts=url.pathname.split('/'),quiz=lmsFindQuiz(parts[3]);
    const attempt=(store.quizAttempts||[]).find(a=>a.id===parts[5]&&a.quizId===parts[3]);
    if(!quiz||!attempt)return send(res,404,{error:'Quiz attempt not found.'});
    if(attempt.studentId!==req.auth.id)return send(res,403,{error:'This attempt belongs to another student.'});
    if(!(attempt.proctor&&attempt.proctor.consentedAt))return send(res,403,{error:'Proctoring is not enabled for this attempt.'});
    if(attempt.status!=='in-progress')return send(res,400,{error:'This attempt is no longer in progress.'});
    const snaps=attempt.proctor.snapshots||[];
    if(snaps.length>=20)return send(res,200,{snapshots:snaps.length,capped:true});
    const dataUrl=String(body.dataUrl||'');
    if(!/^data:image\/(jpeg|png);base64,/.test(dataUrl)||dataUrl.length>300000)return send(res,400,{error:'Snapshot must be a JPEG/PNG data URL under ~300KB.'});
    snaps.push({at:new Date().toISOString(),dataUrl});attempt.proctor.snapshots=snaps;
    await persist();send(res,200,{snapshots:snaps.length});
  }).catch(e=>send(res,400,{error:e.message}));
  if (req.method === 'POST' && /^\/api\/teacher\/quiz-attempts\/[^/]+\/grade$/.test(url.pathname)) return readBody(req).then(async body=>{
    const attempt=(store.quizAttempts||[]).find(a=>a.id===url.pathname.split('/')[4]);
    const quiz=attempt&&lmsFindQuiz(attempt.quizId);
    if(!attempt||!quiz)return send(res,404,{error:'Quiz attempt not found.'});
    if(!lmsQuizOwner(quiz,req.auth))return send(res,403,{error:'This quiz belongs to another teacher.'});
    if(attempt.status==='in-progress')return send(res,400,{error:'The student has not submitted this attempt yet.'});
    const grades=(body.grades&&typeof body.grades==='object'&&!Array.isArray(body.grades))?body.grades:{};
    let total=0,earned=0;attempt.questionGrades=attempt.questionGrades||{};
    for(const q of attemptQuestions(attempt,quiz)){
      if(attempt.adaptive&&!(attempt.adaptiveState&&attempt.adaptiveState.askedIds||[]).includes(q.id))continue;
      total+=q.points;
      let pts=(attempt.questionGrades[q.id]&&attempt.questionGrades[q.id].points)||0;
      let fb=(attempt.questionGrades[q.id]&&attempt.questionGrades[q.id].feedback)||'';
      let rubricScores=(attempt.questionGrades[q.id]&&attempt.questionGrades[q.id].rubricScores)||null;
      const g=grades[q.id];
      if(g&&typeof g==='object'){
        if(q.type==='essay'&&Array.isArray(q.rubric)&&q.rubric.length&&g.rubricScores&&typeof g.rubricScores==='object'){
          let sum=0;const rs={};
          for(const r of q.rubric){const p=Number(g.rubricScores[r.id]);if(!Number.isFinite(p)||p<0||p>r.maxPoints)return send(res,400,{error:`Rubric "${r.criterion}": points must be 0 to ${r.maxPoints}.`});rs[r.id]=p;sum+=p;}
          pts=Math.min(sum,q.points);rubricScores=rs;
        }else{const p=Number(g.points);if(!Number.isFinite(p)||p<0||p>q.points)return send(res,400,{error:`Points for a question must be between 0 and ${q.points}.`});pts=p;}
        fb=String(g.feedback||'').slice(0,2000);}
      earned+=pts;attempt.questionGrades[q.id]={points:pts,feedback:fb,rubricScores};}
    attempt.manualScore=total?Math.round(Math.max(0,earned)/total*100):0;attempt.finalScore=attempt.manualScore;
    attempt.passed=attempt.finalScore>=(quiz.passingScore??50);attempt.status='graded';
    if(attempt.passed&&!attempt.passXpAwarded){attempt.passXpAwarded=true;awardXp(attempt.studentId,50,'quiz-passed');}
    if(attempt.finalScore>=90)awardBadge(attempt.studentId,'quiz-master');
    notify.quizGraded(attempt.studentId, quiz.title, `${attempt.finalScore}%`).catch(()=>{});
    {const _u=store.users.find(u=>u.id===attempt.studentId),_qc=(store.courses||[]).find(c=>c.id===quiz.courseId);standards.emitXapi({institutionId:(_qc&&_qc.institutionId)||(_u&&_u.institutionId),user:_u,verbKey:attempt.passed?'passed':'failed',verbDisplay:attempt.passed?'passed':'failed',objectId:`eduverse:quiz:${quiz.id}`,objectName:quiz.title,result:{score:{raw:attempt.finalScore,min:0,max:100},success:attempt.passed,completion:true}});}
    await persist();send(res,200,{attempt});
  }).catch(e=>send(res,400,{error:e.message}));
  if (req.method === 'DELETE' && /^\/api\/teacher\/quiz-attempts\/[^/]+$/.test(url.pathname)) {const idx=(store.quizAttempts||[]).findIndex(a=>a.id===url.pathname.split('/')[4]);const attempt=store.quizAttempts[idx];const quiz=attempt&&lmsFindQuiz(attempt.quizId);if(idx<0||!quiz||!lmsQuizOwner(quiz,req.auth))return send(res,404,{error:'Quiz attempt not found.'});store.quizAttempts.splice(idx,1);return persist().then(()=>send(res,200,{deleted:true}));}
  // ---- Video progress ----
  if (req.method === 'POST' && url.pathname === '/api/video/progress') return readBody(req).then(async body=>{
    const courseId=String(body.courseId||''),lessonId=String(body.lessonId||'').slice(0,100);
    const course=(store.courses||[]).find(c=>c.id===courseId);
    if(!course)return send(res,404,{error:'Course not found.'});
    if(req.auth.role==='student'&&!(store.enrollments||[]).some(e=>e.studentId===req.auth.id&&e.courseId===courseId))return send(res,403,{error:'Enroll in this course to track video progress.'});
    if(!lessonId)return send(res,400,{error:'lessonId is required.'});
    const lesson=courseAllLessons(course).find(l=>l.id===lessonId);
    if(!lesson)return send(res,400,{error:'Lesson not found in this course.'});
    const positionSec=Math.max(0,Math.min(86400,Number(body.positionSec)||0));
    const watchedSec=Math.max(0,Math.min(86400,Number(body.watchedSec)||0));
    const key=`${req.auth.id}:${courseId}:${lessonId}`,prev=store.videoProgress[key];
    const duration=Number(lesson.videoDurationSec)||0;
    const completed=!!(prev&&prev.completed)||body.completed===true||(duration>0&&watchedSec>=duration*0.9);
    store.videoProgress[key]={positionSec,watchedSec,completed,updatedAt:new Date().toISOString()};
    let lessonCompleted=false;
    if(completed){const ckey=`${req.auth.id}:${courseId}`;store.courseLessonProgress[ckey] ||= [];
      if(!store.courseLessonProgress[ckey].includes(lessonId)){store.courseLessonProgress[ckey].push(lessonId);awardXp(req.auth.id,15,'video-complete');awardBadge(req.auth.id,'first-steps');lessonCompleted=true;}}
    await persist();send(res,200,{saved:true,completed,lessonCompleted});
  }).catch(e=>send(res,400,{error:e.message}));
  if (req.method === 'GET' && url.pathname === '/api/video/progress') {
    const courseId=String(url.searchParams.get('courseId')||'');
    if(!courseId)return send(res,400,{error:'courseId is required.'});
    if(req.auth.role==='student'&&!(store.enrollments||[]).some(e=>e.studentId===req.auth.id&&e.courseId===courseId))return send(res,403,{error:'Enroll in this course to view video progress.'});
    const prefix=`${req.auth.id}:${courseId}:`,map={};
    for(const [k,v] of Object.entries(store.videoProgress||{}))if(k.startsWith(prefix))map[k.slice(prefix.length)]={positionSec:v.positionSec,watchedSec:v.watchedSec,completed:!!v.completed};
    return send(res,200,{progress:map});
  }
  // ---- Certificates ----
  if (req.method === 'POST' && url.pathname === '/api/certificates/issue') return readBody(req).then(async body=>{
    const courseId=String(body.courseId||''),check=certificateEligibility(req.auth.id,courseId);
    if(!check.course)return send(res,404,{error:'Course not found.'});
    if(!check.eligible)return send(res,400,{error:'Certificate requirements are not met yet.',missing:check.missing});
    const existing=(store.certificates||[]).find(c=>c.userId===req.auth.id&&c.courseId===courseId);
    if(existing)return send(res,200,{certificate:existing,duplicate:true});
    let code='';for(let i=0;i<5&&!code;i++){const c=base32Encode(randomBytes(8)).slice(0,12);if(!(store.certificates||[]).some(x=>x.code===c))code=c;}
    if(!code)return send(res,500,{error:'Could not generate a certificate code.'});
    const best=check.quizzes.map(q=>{const a=(store.quizAttempts||[]).filter(x=>x.quizId===q.id&&x.studentId===req.auth.id&&x.status==='graded');return a.length?Math.max(...a.map(x=>x.finalScore||0)):0;});
    const scoreAvg=check.quizzes.length?Math.round(best.reduce((n,v)=>n+v,0)/check.quizzes.length):100;
    const cert={id:randomUUID(),code,userId:req.auth.id,userName:req.auth.name,courseId,courseTitle:check.course.title,issuedAt:new Date().toISOString(),scoreAvg};
    store.certificates.unshift(cert);awardXp(req.auth.id,100,'certificate');awardBadge(req.auth.id,'graduate');
    await persist();send(res,201,{certificate:cert});
  }).catch(e=>send(res,400,{error:e.message}));
  if (req.method === 'GET' && url.pathname === '/api/certificates') return send(res,200,{certificates:(store.certificates||[]).filter(c=>c.userId===req.auth.id)});
  if (req.method === 'GET' && /^\/api\/certificates\/verify\/[^/]+$/.test(url.pathname)) {
    const cert=(store.certificates||[]).find(c=>c.code===String(url.pathname.split('/').at(-1)).toUpperCase());
    if(!cert)return send(res,200,{valid:false});
    return send(res,200,{valid:true,certificate:{code:cert.code,userName:cert.userName,courseTitle:cert.courseTitle,issuedAt:cert.issuedAt,scoreAvg:cert.scoreAvg}});
  }
  if (req.method === 'GET' && url.pathname === '/api/teacher/certificates') {
    if(req.auth.role==='admin')return send(res,200,{certificates:store.certificates||[]});
    const mine=new Set((store.courses||[]).filter(c=>c.ownerId===req.auth.id).map(c=>c.id));
    return send(res,200,{certificates:(store.certificates||[]).filter(c=>mine.has(c.courseId))});
  }
  // ---- Plans, checkout, billing, webhook (TEST MODE) ----
  if (req.method === 'GET' && url.pathname === '/api/plans') return send(res,200,{plans:(store.plans||[]).filter(p=>p.active!==false)});
  if (req.method === 'POST' && url.pathname === '/api/admin/plans') return readBody(req).then(async body=>{
    const name=String(body.name||'').trim(),priceCents=Math.floor(Number(body.priceCents)),interval=body.interval||'one-time';
    if(name.length<2||name.length>80)return send(res,400,{error:'Plan name must be 2 to 80 characters.'});
    if(!Number.isInteger(priceCents)||priceCents<0||priceCents>100000000)return send(res,400,{error:'Enter a valid price in cents.'});
    if(!['one-time','monthly','yearly'].includes(interval))return send(res,400,{error:'Choose a valid billing interval.'});
    const features=Array.isArray(body.features)?body.features.map(f=>String(f).slice(0,120)).filter(Boolean).slice(0,20):[];
    const currency=/^[A-Z]{3}$/.test(String(body.currency||'INR'))?String(body.currency||'INR'):'INR';
    if(body.id){const plan=(store.plans||[]).find(p=>p.id===body.id);if(!plan)return send(res,404,{error:'Plan not found.'});
      Object.assign(plan,{name,priceCents,currency,interval,features});if(typeof body.active==='boolean')plan.active=body.active;plan.updatedAt=new Date().toISOString();
      audit(req.auth,'updated plan',name);await persist();return send(res,200,{plan});}
    const plan={id:randomUUID(),name,priceCents,currency,interval,features,active:true,createdAt:new Date().toISOString()};
    store.plans.unshift(plan);audit(req.auth,'created plan',name);await persist();send(res,201,{plan});
  }).catch(e=>send(res,400,{error:e.message}));
  if (req.method === 'PATCH' && /^\/api\/admin\/plans\/[^/]+$/.test(url.pathname)) return readBody(req).then(async body=>{
    const plan=(store.plans||[]).find(p=>p.id===url.pathname.split('/')[4]);if(!plan)return send(res,404,{error:'Plan not found.'});
    if(body.name!==undefined){const n=String(body.name).trim();if(n.length<2||n.length>80)return send(res,400,{error:'Plan name must be 2 to 80 characters.'});plan.name=n;}
    if(body.priceCents!==undefined){const p=Math.floor(Number(body.priceCents));if(!Number.isInteger(p)||p<0||p>100000000)return send(res,400,{error:'Enter a valid price in cents.'});plan.priceCents=p;}
    if(body.interval!==undefined){if(!['one-time','monthly','yearly'].includes(body.interval))return send(res,400,{error:'Choose a valid billing interval.'});plan.interval=body.interval;}
    if(body.features!==undefined)plan.features=Array.isArray(body.features)?body.features.map(f=>String(f).slice(0,120)).filter(Boolean).slice(0,20):[];
    if(body.currency!==undefined){if(!/^[A-Z]{3}$/.test(String(body.currency)))return send(res,400,{error:'Currency must be a 3-letter code.'});plan.currency=String(body.currency);}
    if(typeof body.active==='boolean')plan.active=body.active;
    plan.updatedAt=new Date().toISOString();audit(req.auth,'updated plan',plan.name);await persist();send(res,200,{plan});
  }).catch(e=>send(res,400,{error:e.message}));
  if (req.method === 'DELETE' && /^\/api\/admin\/plans\/[^/]+$/.test(url.pathname)) {const plan=(store.plans||[]).find(p=>p.id===url.pathname.split('/')[4]);if(!plan)return send(res,404,{error:'Plan not found.'});plan.active=false;audit(req.auth,'deactivated plan',plan.name);return persist().then(()=>send(res,200,{plan}));}
  if (req.method === 'GET' && url.pathname === '/api/admin/orders') return send(res,200,{orders:(store.orders||[]).map(o=>({...o,userName:store.users.find(u=>u.id===o.userId)?.name||'',refName:o.kind==='plan'?(store.plans||[]).find(p=>p.id===o.refId)?.name||'':(store.courses||[]).find(c=>c.id===o.refId)?.title||''}))});
  if (req.method === 'GET' && url.pathname === '/api/admin/subscriptions') return send(res,200,{subscriptions:(store.subscriptions||[]).map(s=>({...s,userName:store.users.find(u=>u.id===s.userId)?.name||'',planName:(store.plans||[]).find(p=>p.id===s.planId)?.name||''}))});
  if (req.method === 'POST' && url.pathname === '/api/checkout') return readBody(req).then(async body=>{
    const kind=body.kind;
    if(kind==='plan'){
      const plan=(store.plans||[]).find(p=>p.id===body.planId&&p.active!==false);
      if(!plan)return send(res,404,{error:'Plan not found.'});
      const order={id:randomUUID(),userId:req.auth.id,kind:'plan',refId:plan.id,amountCents:plan.priceCents,currency:plan.currency||'INR',status:'pending',testMode:true,createdAt:new Date().toISOString(),paidAt:null};
      store.orders.unshift(order);await persist();
      return send(res,201,{order,testMode:true,message:'Test mode: confirm to simulate payment.'});
    }
    if(kind==='course'){
      const course=(store.courses||[]).find(c=>c.id===body.courseId);
      if(!course)return send(res,404,{error:'Course not found.'});
      const price=Math.floor(Number(course.priceCents||0));
      if(price<=0)return send(res,400,{error:'This course is free — just enroll.'});
      if((store.orders||[]).some(o=>o.userId===req.auth.id&&o.kind==='course'&&o.refId===course.id&&o.status==='paid'))return send(res,400,{error:'You already own this course.'});
      const order={id:randomUUID(),userId:req.auth.id,kind:'course',refId:course.id,amountCents:price,currency:course.currency||'INR',status:'pending',testMode:true,createdAt:new Date().toISOString(),paidAt:null};
      store.orders.unshift(order);await persist();
      return send(res,201,{order,testMode:true,message:'Test mode: confirm to simulate payment.'});
    }
    return send(res,400,{error:'Choose plan or course checkout.'});
  }).catch(e=>send(res,400,{error:e.message}));
  if (req.method === 'POST' && /^\/api\/checkout\/[^/]+\/confirm$/.test(url.pathname)) return readBody(req).then(async body=>{
    const order=(store.orders||[]).find(o=>o.id===url.pathname.split('/')[3]&&o.userId===req.auth.id);
    if(!order)return send(res,404,{error:'Order not found.'});
    if(order.status!=='pending')return send(res,400,{error:'This order is no longer pending.'});
    order.status='paid';order.paidAt=new Date().toISOString();
    if(order.kind==='plan'){
      const plan=(store.plans||[]).find(p=>p.id===order.refId&&p.active!==false);
      if(!plan){order.status='failed';await persist();return send(res,400,{error:'That plan is no longer available.'});}
      const nowMs=Date.now();
      for(const s of (store.subscriptions||[]))if(s.userId===req.auth.id&&s.status==='active'){s.status='expired';s.endedAt=new Date().toISOString();}
      const endsAt=plan.interval==='monthly'?new Date(nowMs+30*86400000).toISOString():plan.interval==='yearly'?new Date(nowMs+365*86400000).toISOString():null;
      const sub={id:randomUUID(),userId:req.auth.id,planId:plan.id,status:'active',startedAt:new Date().toISOString(),endsAt,cancelledAt:null};
      store.subscriptions.unshift(sub);await persist();
      return send(res,200,{order,subscription:sub,testMode:true});
    }
    await persist();send(res,200,{order,testMode:true});
  }).catch(e=>send(res,400,{error:e.message}));
  if (req.method === 'POST' && /^\/api\/checkout\/[^/]+\/cancel$/.test(url.pathname)) {const order=(store.orders||[]).find(o=>o.id===url.pathname.split('/')[3]&&o.userId===req.auth.id);if(!order)return send(res,404,{error:'Order not found.'});if(order.status!=='pending')return send(res,400,{error:'This order is no longer pending.'});order.status='failed';return persist().then(()=>send(res,200,{order}));}
  if (req.method === 'GET' && url.pathname === '/api/billing') return send(res,200,{subscription:activeSubscription(req.auth.id),orders:(store.orders||[]).filter(o=>o.userId===req.auth.id)});
  if (req.method === 'POST' && url.pathname === '/api/billing/cancel') return readBody(req).then(async body=>{
    const sub=activeSubscription(req.auth.id);
    if(!sub)return send(res,404,{error:'No active subscription found.'});
    sub.status='cancelled';sub.cancelledAt=new Date().toISOString();
    await persist();send(res,200,{subscription:sub});
  }).catch(e=>send(res,400,{error:e.message}));
  if (req.method === 'POST' && url.pathname === '/api/payments/webhook') return readBody(req).then(async body=>{
    const secret=process.env.PAYMENTS_WEBHOOK_SECRET;
    if(!secret)return send(res,503,{error:'Payment webhook is not configured yet. Connect a payment provider to enable it.'});
    if(req.headers['x-webhook-secret']!==secret)return send(res,401,{error:'Invalid webhook signature.'});
    const event=String(body.event||'').trim();
    if(!event)return send(res,400,{error:'Provide a webhook event name.'});
    console.log(`[payments-webhook] event=${event} orderId=${String(body.orderId||'n/a').slice(0,80)}`);
    send(res,200,{received:true});
  }).catch(e=>send(res,400,{error:e.message}));
  // ---- Discussions ----
  if (req.method === 'GET' && /^\/api\/courses\/[^/]+\/discussions$/.test(url.pathname)) {
    const course=(store.courses||[]).find(c=>c.id===url.pathname.split('/')[3]);
    if(!course)return send(res,404,{error:'Course not found.'});
    if(!canViewCourseDiscussions(req.auth,course))return send(res,403,{error:'Enroll in this course to join the discussion.'});
    const threads=(store.discussions||[]).filter(d=>d.courseId===course.id).sort((a,b)=>((b.pinned?1:0)-(a.pinned?1:0))||(b.createdAt<a.createdAt?-1:1));
    return send(res,200,{discussions:threads});
  }
  if (req.method === 'POST' && /^\/api\/courses\/[^/]+\/discussions$/.test(url.pathname)) return readBody(req).then(async body=>{
    const course=(store.courses||[]).find(c=>c.id===url.pathname.split('/')[3]);
    if(!course)return send(res,404,{error:'Course not found.'});
    if(!canViewCourseDiscussions(req.auth,course))return send(res,403,{error:'Enroll in this course to join the discussion.'});
    const title=String(body.title||'').trim(),text=String(body.body||'').trim();
    if(title.length<3||title.length>120)return send(res,400,{error:'Thread title must be 3 to 120 characters.'});
    if(!text||text.length>5000)return send(res,400,{error:'Thread text is required (up to 5,000 characters).'});
    const thread={id:randomUUID(),courseId:course.id,authorId:req.auth.id,authorName:req.auth.name,title,body:text,pinned:false,createdAt:new Date().toISOString(),replyCount:0};
    store.discussions.unshift(thread);awardXp(req.auth.id,5,'discussion-thread');await persist();send(res,201,{discussion:thread});
  }).catch(e=>send(res,400,{error:e.message}));
  if (req.method === 'GET' && /^\/api\/discussions\/[^/]+$/.test(url.pathname)) {
    const thread=(store.discussions||[]).find(d=>d.id===url.pathname.split('/')[3]);
    if(!thread)return send(res,404,{error:'Discussion not found.'});
    const course=(store.courses||[]).find(c=>c.id===thread.courseId);
    if(!canViewCourseDiscussions(req.auth,course))return send(res,403,{error:'Enroll in this course to join the discussion.'});
    return send(res,200,{discussion:thread,replies:(store.discussionReplies||[]).filter(r=>r.discussionId===thread.id)});
  }
  if (req.method === 'POST' && /^\/api\/discussions\/[^/]+\/replies$/.test(url.pathname)) return readBody(req).then(async body=>{
    const thread=(store.discussions||[]).find(d=>d.id===url.pathname.split('/')[3]);
    if(!thread)return send(res,404,{error:'Discussion not found.'});
    const course=(store.courses||[]).find(c=>c.id===thread.courseId);
    if(!canViewCourseDiscussions(req.auth,course))return send(res,403,{error:'Enroll in this course to join the discussion.'});
    const text=String(body.body||'').trim();
    if(!text||text.length>5000)return send(res,400,{error:'Reply text is required (up to 5,000 characters).'});
    const reply={id:randomUUID(),discussionId:thread.id,authorId:req.auth.id,authorName:req.auth.name,body:text,createdAt:new Date().toISOString()};
    store.discussionReplies.push(reply);thread.replyCount=(thread.replyCount||0)+1;
    awardXp(req.auth.id,3,'discussion-reply');
    if((store.discussionReplies||[]).filter(r=>r.authorId===req.auth.id).length>=5)awardBadge(req.auth.id,'helper');
    await persist();send(res,201,{reply,discussion:thread});
  }).catch(e=>send(res,400,{error:e.message}));
  if (req.method === 'POST' && /^\/api\/discussions\/[^/]+\/pin$/.test(url.pathname)) {
    const thread=(store.discussions||[]).find(d=>d.id===url.pathname.split('/')[3]);
    if(!thread)return send(res,404,{error:'Discussion not found.'});
    const course=(store.courses||[]).find(c=>c.id===thread.courseId);
    if(req.auth.role!=='admin'&&(!course||course.ownerId!==req.auth.id))return send(res,403,{error:'Only the course teacher can pin threads.'});
    thread.pinned=!thread.pinned;return persist().then(()=>send(res,200,{discussion:thread}));
  }
  if (req.method === 'DELETE' && /^\/api\/discussions\/[^/]+$/.test(url.pathname)) {
    const id=url.pathname.split('/')[3],idx=(store.discussions||[]).findIndex(d=>d.id===id);
    const thread=store.discussions[idx];if(idx<0)return send(res,404,{error:'Discussion not found.'});
    const course=(store.courses||[]).find(c=>c.id===thread.courseId);
    if(req.auth.role!=='admin'&&thread.authorId!==req.auth.id&&(!course||course.ownerId!==req.auth.id))return send(res,403,{error:'You can only delete your own threads.'});
    store.discussions.splice(idx,1);store.discussionReplies=(store.discussionReplies||[]).filter(r=>r.discussionId!==id);
    return persist().then(()=>send(res,200,{deleted:true}));
  }
  // ---- Live sessions ----
  if (req.method === 'POST' && url.pathname === '/api/teacher/live-sessions') return readBody(req).then(async body=>{
    const title=String(body.title||'').trim();
    if(title.length<3||title.length>120)return send(res,400,{error:'Session title must be 3 to 120 characters.'});
    const startsMs=new Date(String(body.startsAt||'')).getTime();
    if(!Number.isFinite(startsMs)||startsMs<=Date.now())return send(res,400,{error:'Choose a future start time.'});
    const durationMin=Math.floor(Number(body.durationMin)||0);
    if(durationMin<15||durationMin>480)return send(res,400,{error:'Duration must be 15 to 480 minutes.'});
    const meetingUrl=String(body.meetingUrl||'').trim();
    const useClassroom=body.useClassroom===true;
    if(!useClassroom&&(!/^https:\/\//.test(meetingUrl)||meetingUrl.length>2000))return send(res,400,{error:'Provide a valid https meeting URL.'});
    let courseId=null;
    if(body.courseId){const c=(store.courses||[]).find(x=>x.id===body.courseId);if(!c)return send(res,404,{error:'Course not found.'});if(req.auth.role!=='admin'&&c.ownerId!==req.auth.id)return send(res,403,{error:'Choose one of your own courses.'});courseId=c.id;}
    const session={id:randomUUID(),courseId,ownerId:req.auth.id,title,description:String(body.description||'').slice(0,2000),startsAt:new Date(startsMs).toISOString(),durationMin,meetingUrl,useClassroom,status:'scheduled',attendees:[],createdAt:new Date().toISOString()};
    store.liveSessions.unshift(session);await persist();
    // Notify enrolled students if this is a course session
    if (courseId) {
      const studentIds = (store.enrollments || []).filter(e => e.courseId === courseId).map(e => e.studentId);
      notify.liveClassScheduled(studentIds, title, session.startsAt).catch(() => {});
      await persist();
    }
    send(res,201,{session});
  }).catch(e=>send(res,400,{error:e.message}));
  if (req.method === 'GET' && url.pathname === '/api/teacher/live-sessions') {
    const list=req.auth.role==='admin'?(store.liveSessions||[]):(store.liveSessions||[]).filter(s=>s.ownerId===req.auth.id);
    return send(res,200,{sessions:list});
  }
  if (req.method === 'GET' && url.pathname === '/api/live-sessions') {
    let list=(store.liveSessions||[]).filter(s=>['scheduled','live'].includes(s.status));
    if(req.auth.role==='student'){
      const enrolled=new Set((store.enrollments||[]).filter(e=>e.studentId===req.auth.id).map(e=>e.courseId));
      list=list.filter(s=>!s.courseId||enrolled.has(s.courseId)||((store.courses||[]).find(c=>c.id===s.courseId)||{}).status==='published');
    }
    list=[...list].sort((a,b)=>a.startsAt<b.startsAt?-1:1);
    return send(res,200,{sessions:list.map(({meetingUrl,...s})=>({...s,attendeeCount:(s.attendees||[]).length}))});
  }
  if (req.method === 'PATCH' && /^\/api\/teacher\/live-sessions\/[^/]+$/.test(url.pathname)) return readBody(req).then(async body=>{
    const s=(store.liveSessions||[]).find(x=>x.id===url.pathname.split('/')[4]);
    if(!s||(req.auth.role!=='admin'&&s.ownerId!==req.auth.id))return send(res,404,{error:'Live session not found.'});
    if(body.title!==undefined){const t=String(body.title).trim();if(t.length<3||t.length>120)return send(res,400,{error:'Session title must be 3 to 120 characters.'});s.title=t;}
    if(body.description!==undefined)s.description=String(body.description).slice(0,2000);
    if(body.startsAt!==undefined){const t=new Date(String(body.startsAt)).getTime();if(!Number.isFinite(t))return send(res,400,{error:'Choose a valid start time.'});s.startsAt=new Date(t).toISOString();}
    if(body.durationMin!==undefined){const d=Math.floor(Number(body.durationMin));if(d<15||d>480)return send(res,400,{error:'Duration must be 15 to 480 minutes.'});s.durationMin=d;}
    if(body.meetingUrl!==undefined){const u=String(body.meetingUrl).trim();if(!/^https:\/\//.test(u)||u.length>2000)return send(res,400,{error:'Provide a valid https meeting URL.'});s.meetingUrl=u;}
    if(body.status!==undefined){if(!['scheduled','live','ended'].includes(body.status))return send(res,400,{error:'Invalid session status.'});s.status=body.status;}
    await persist();send(res,200,{session:s});
  }).catch(e=>send(res,400,{error:e.message}));
  if (req.method === 'DELETE' && /^\/api\/teacher\/live-sessions\/[^/]+$/.test(url.pathname)) {const idx=(store.liveSessions||[]).findIndex(x=>x.id===url.pathname.split('/')[4]);const s=store.liveSessions[idx];if(idx<0||(req.auth.role!=='admin'&&s.ownerId!==req.auth.id))return send(res,404,{error:'Live session not found.'});store.liveSessions.splice(idx,1);return persist().then(()=>send(res,200,{deleted:true}));}
  if (req.method === 'POST' && /^\/api\/live-sessions\/[^/]+\/join$/.test(url.pathname)) return readBody(req).then(async body=>{
    const session=(store.liveSessions||[]).find(s=>s.id===url.pathname.split('/')[3]);
    if(!session)return send(res,404,{error:'Live session not found.'});
    if(!['scheduled','live'].includes(session.status))return send(res,400,{error:'This session has ended.'});
    const isOwner=session.ownerId===req.auth.id;
    if(!isOwner&&req.auth.role!=='admin'&&req.auth.role==='student'&&session.courseId){
      const course=(store.courses||[]).find(c=>c.id===session.courseId);
      const enrolled=(store.enrollments||[]).some(e=>e.studentId===req.auth.id&&e.courseId===session.courseId);
      if(!enrolled&&(!course||course.status!=='published'))return send(res,403,{error:'Enroll in this course to join the live session.'});
    }
    session.attendees ||= [];
    const firstJoin=!session.attendees.includes(req.auth.id);
    if(firstJoin){session.attendees.push(req.auth.id);awardXp(req.auth.id,25,'live-session');}
    session.attendance ||= [];
    const nowIso=new Date().toISOString();
    const attLog=session.attendance.find(a=>a.userId===req.auth.id);
    if(attLog)attLog.joinedAt=nowIso;else session.attendance.push({userId:req.auth.id,name:req.auth.name||'Participant',joinedAt:nowIso});
    await persist();send(res,200,{meetingUrl:session.meetingUrl,joined:true,attendees:session.attendees.length});
  }).catch(e=>send(res,400,{error:e.message}));
  // ---- Live classroom (slice 3): WebRTC signaling credentials ----
  if (req.method === 'GET' && /^\/api\/live-sessions\/[^/]+\/classroom$/.test(url.pathname)) {
    const session=(store.liveSessions||[]).find(s=>s.id===url.pathname.split('/')[3]);
    if(!session)return send(res,404,{error:'Live session not found.'});
    if(session.status==='ended')return send(res,400,{error:'This session has ended.'});
    if(!liveClassroomAccess(req.auth,session))return send(res,403,{error:'Join this live session to enter the classroom.'});
    return send(res,200,{roomId:'live:'+session.id,wsUrl:'/ws',iceServers:[{urls:['stun:stun.l.google.com:19302']}]});
  }
  if (req.method === 'POST' && /^\/api\/live-sessions\/[^/]+\/classroom\/end$/.test(url.pathname)) {
    const session=(store.liveSessions||[]).find(s=>s.id===url.pathname.split('/')[3]);
    if(!session||(req.auth.role!=='admin'&&session.ownerId!==req.auth.id))return send(res,404,{error:'Live session not found.'});
    session.status='ended';session.endedAt=new Date().toISOString();
    live.closeRoom('live:'+session.id);
    return persist().then(()=>send(res,200,{session:{id:session.id,status:session.status}}));
  }
  // ---- Classroom session records (slice 2): save a completed session + participation ----
  if (req.method === 'POST' && /^\/api\/live-sessions\/[^/]+\/end-classroom$/.test(url.pathname)) return readBody(req).then(async body=>{
    const session=(store.liveSessions||[]).find(s=>s.id===url.pathname.split('/')[3]);
    if(!session||(session.ownerId!==req.auth.id&&!org.isAdminRole(req.auth.role)))return send(res,404,{error:'Live session not found.'});
    const existing=(store.classSessionRecords||[]).find(r=>r.sessionId===session.id);
    if(existing){session.status='ended';if(!session.endedAt)session.endedAt=existing.endedAt;live.closeRoom('live:'+session.id);await persist();return send(res,200,{record:existing,alreadyRecorded:true});}
    const summary=validateSessionSummary(body&&body.summary!==undefined?body.summary:body);
    const record=buildSessionRecord(session,summary);
    store.classSessionRecords.unshift(record);
    session.status='ended';session.endedAt=record.endedAt;
    live.closeRoom('live:'+session.id);
    audit(req.auth,'ended classroom session',session.title);
    await persist();send(res,201,{record});
  }).catch(e=>send(res,400,{error:e.message}));
  if (req.method === 'GET' && url.pathname === '/api/teacher/session-records') {
    const q=new URL(req.url,'http://localhost').searchParams;
    let list=(store.classSessionRecords||[]);
    if(org.isAdminRole(req.auth.role)){const s=org.orgScope(req.auth);list=list.filter(r=>!s.institutionId||!r.institutionId||r.institutionId===s.institutionId);}
    else list=list.filter(r=>r.teacherId===req.auth.id);
    if(q.get('courseId'))list=list.filter(r=>r.courseId===q.get('courseId'));
    list=[...list].sort((a,b)=>String(b.endedAt||'').localeCompare(String(a.endedAt||'')));
    return send(res,200,{records:list});
  }
  if (req.method === 'GET' && url.pathname === '/api/session-records') {
    let list=(store.classSessionRecords||[]);
    if(org.isAdminRole(req.auth.role)){const s=org.orgScope(req.auth);list=list.filter(r=>!s.institutionId||!r.institutionId||r.institutionId===s.institutionId);}
    else if(req.auth.role==='teacher'){list=list.filter(r=>r.teacherId===req.auth.id||(r.participants||[]).some(p=>p.userId===req.auth.id));}
    else{list=list.filter(r=>(r.participants||[]).some(p=>p.userId===req.auth.id));}
    list=[...list].sort((a,b)=>String(b.endedAt||'').localeCompare(String(a.endedAt||'')));
    return send(res,200,{records:list});
  }
  if (req.method === 'GET' && /^\/api\/session-records\/[^/]+$/.test(url.pathname)) {
    const record=(store.classSessionRecords||[]).find(r=>r.id===url.pathname.split('/')[3]);
    if(!record||!sessionRecordVisible(req.auth,record))return send(res,404,{error:'Session record not found.'});
    return send(res,200,{record});
  }
  if (req.method === 'GET' && url.pathname === '/api/admin/session-records') {
    const q=new URL(req.url,'http://localhost').searchParams;
    const s=org.orgScope(req.auth);
    let list=(store.classSessionRecords||[]).filter(r=>!s.institutionId||!r.institutionId||r.institutionId===s.institutionId);
    if(q.get('courseId'))list=list.filter(r=>r.courseId===q.get('courseId'));
    if(q.get('teacherId'))list=list.filter(r=>r.teacherId===q.get('teacherId'));
    list=[...list].sort((a,b)=>String(b.endedAt||'').localeCompare(String(a.endedAt||'')));
    return send(res,200,{records:list});
  }
  // ---- Study groups (slice 3, advanced-features round): collaborative learning ----
  // Persistent student-owned spaces: members, shared notes (last-writer-wins), group chat.
  // Every group route is members-only (404 for non-members, so existence doesn't leak).
  const findStudyGroup = id => (store.studyGroups || []).find(g => g.id === id);
  const groupMemberOr404 = (group, user) => {
    if (!group) return null;
    if (studygroups.isMember(group, user.id)) return group;
    if (org.isAdminRole(user.role)) return group; // platform admins can moderate
    return null;
  };
  if (req.method === 'POST' && url.pathname === '/api/study-groups') return readBody(req).then(async body => {
    if (!['student', 'teacher', 'admin'].includes(req.auth.role)) return send(res, 403, { error: 'Only students and teachers can create study groups.' });
    let input;
    try { input = studygroups.validateGroupInput(body); } catch (e) { return send(res, 400, { error: e.message }); }
    if (input.courseId) {
      const course = (store.courses || []).find(c => c.id === input.courseId);
      if (!course) return send(res, 404, { error: 'Course not found.' });
      if (req.auth.role === 'student') return send(res, 403, { error: 'Students create course-free groups.' });
      if (req.auth.role === 'teacher' && course.ownerId !== req.auth.id) return send(res, 403, { error: 'Choose one of your own courses.' });
    }
    const now = new Date().toISOString();
    const group = { id: randomUUID(), name: input.name, description: input.description, courseId: input.courseId,
      ownerId: req.auth.id, inviteCode: studygroups.generateInviteCode(store.studyGroups),
      members: [{ userId: req.auth.id, name: req.auth.name, role: 'admin', joinedAt: now }], createdAt: now };
    store.studyGroups.unshift(group);
    await persist();
    send(res, 201, { group: studygroups.publicGroup(group, store) });
  }).catch(e => send(res, 400, { error: e.message }));
  if (req.method === 'GET' && url.pathname === '/api/study-groups') {
    const list = (store.studyGroups || []).filter(g => studygroups.isMember(g, req.auth.id))
      .sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')));
    return send(res, 200, { groups: list.map(g => studygroups.publicGroup(g, store)) });
  }
  if (req.method === 'POST' && url.pathname === '/api/study-groups/join-by-code') return readBody(req).then(async body => {
    const code = String((body && body.inviteCode) || '').trim().toUpperCase();
    if (!code) return send(res, 400, { error: 'Invite code is required.' });
    const group = (store.studyGroups || []).find(g => String(g.inviteCode || '').toUpperCase() === code);
    if (!group) return send(res, 404, { error: 'No group with that invite code.' });
    if (studygroups.isMember(group, req.auth.id)) return send(res, 200, { group: studygroups.publicGroup(group, store), alreadyMember: true });
    group.members.push({ userId: req.auth.id, name: req.auth.name, role: 'member', joinedAt: new Date().toISOString() });
    await persist();
    send(res, 200, { group: studygroups.publicGroup(group, store) });
  }).catch(e => send(res, 400, { error: e.message }));
  if (req.method === 'GET' && /^\/api\/study-groups\/[^/]+$/.test(url.pathname)) {
    const group = groupMemberOr404(findStudyGroup(url.pathname.split('/')[3]), req.auth);
    if (!group) return send(res, 404, { error: 'Study group not found.' });
    return send(res, 200, { group: studygroups.publicGroup(group, store) });
  }
  if (req.method === 'POST' && /^\/api\/study-groups\/[^/]+\/join$/.test(url.pathname)) return readBody(req).then(async body => {
    const group = findStudyGroup(url.pathname.split('/')[3]);
    if (!group) return send(res, 404, { error: 'Study group not found.' });
    if (studygroups.isMember(group, req.auth.id)) return send(res, 200, { group: studygroups.publicGroup(group, store), alreadyMember: true });
    const code = String((body && body.inviteCode) || '').trim().toUpperCase();
    if (!code || code !== String(group.inviteCode || '').toUpperCase()) return send(res, 403, { error: 'Wrong invite code.' });
    group.members.push({ userId: req.auth.id, name: req.auth.name, role: 'member', joinedAt: new Date().toISOString() });
    await persist();
    send(res, 200, { group: studygroups.publicGroup(group, store) });
  }).catch(e => send(res, 400, { error: e.message }));
  if (req.method === 'POST' && /^\/api\/study-groups\/[^/]+\/leave$/.test(url.pathname)) return readBody(req).then(async body => {
    const group = findStudyGroup(url.pathname.split('/')[3]);
    if (!group || !studygroups.isMember(group, req.auth.id)) return send(res, 404, { error: 'Study group not found.' });
    group.members = group.members.filter(m => m.userId !== req.auth.id);
    if (!group.members.length) {
      store.studyGroups = store.studyGroups.filter(g => g.id !== group.id);
      store.groupNotes = (store.groupNotes || []).filter(n => n.groupId !== group.id);
      store.groupMessages = (store.groupMessages || []).filter(m => m.groupId !== group.id);
      await persist();
      return send(res, 200, { left: true, groupDeleted: true });
    }
    if (group.ownerId === req.auth.id) {
      const next = [...group.members].sort((a, b) => String(a.joinedAt || '').localeCompare(String(b.joinedAt || '')))[0];
      group.ownerId = next.userId; next.role = 'admin';
    }
    await persist();
    send(res, 200, { left: true });
  }).catch(e => send(res, 400, { error: e.message }));
  if (req.method === 'DELETE' && /^\/api\/study-groups\/[^/]+$/.test(url.pathname)) {
    const group = findStudyGroup(url.pathname.split('/')[3]);
    if (!group) return send(res, 404, { error: 'Study group not found.' });
    if (!studygroups.canModerate(group, req.auth.id) && !org.isAdminRole(req.auth.role)) return send(res, 404, { error: 'Study group not found.' });
    store.studyGroups = store.studyGroups.filter(g => g.id !== group.id);
    store.groupNotes = (store.groupNotes || []).filter(n => n.groupId !== group.id);
    store.groupMessages = (store.groupMessages || []).filter(m => m.groupId !== group.id);
    await persist();
    return send(res, 200, { deleted: true });
  }
  if (req.method === 'GET' && /^\/api\/study-groups\/[^/]+\/notes$/.test(url.pathname)) {
    const group = groupMemberOr404(findStudyGroup(url.pathname.split('/')[3]), req.auth);
    if (!group) return send(res, 404, { error: 'Study group not found.' });
    const notes = (store.groupNotes || []).filter(n => n.groupId === group.id)
      .sort((a, b) => String(b.updatedAt || '').localeCompare(String(a.updatedAt || '')));
    return send(res, 200, { notes: notes.map(n => studygroups.publicNote(n, store)) });
  }
  if (req.method === 'POST' && /^\/api\/study-groups\/[^/]+\/notes$/.test(url.pathname)) return readBody(req).then(async body => {
    const group = groupMemberOr404(findStudyGroup(url.pathname.split('/')[3]), req.auth);
    if (!group) return send(res, 404, { error: 'Study group not found.' });
    let input;
    try { input = studygroups.validateNoteInput(body); } catch (e) { return send(res, 400, { error: e.message }); }
    const now = new Date().toISOString();
    const note = { id: randomUUID(), groupId: group.id, authorId: req.auth.id, authorName: req.auth.name,
      title: input.title, content: input.content, createdAt: now, updatedAt: now, lastEditedBy: req.auth.id };
    store.groupNotes.unshift(note);
    await persist();
    send(res, 201, { note: studygroups.publicNote(note, store) });
  }).catch(e => send(res, 400, { error: e.message }));
  if (req.method === 'PATCH' && /^\/api\/study-groups\/[^/]+\/notes\/[^/]+$/.test(url.pathname)) return readBody(req).then(async body => {
    const parts = url.pathname.split('/');
    const group = groupMemberOr404(findStudyGroup(parts[3]), req.auth);
    if (!group) return send(res, 404, { error: 'Study group not found.' });
    const note = (store.groupNotes || []).find(n => n.id === parts[5] && n.groupId === group.id);
    if (!note) return send(res, 404, { error: 'Note not found.' });
    let input;
    try { input = studygroups.validateNoteUpdate(body); } catch (e) { return send(res, 400, { error: e.message }); }
    if (input.title !== undefined) note.title = input.title;
    if (input.content !== undefined) note.content = input.content;
    note.updatedAt = new Date().toISOString(); note.lastEditedBy = req.auth.id;
    await persist();
    send(res, 200, { note: studygroups.publicNote(note, store) });
  }).catch(e => send(res, 400, { error: e.message }));
  if (req.method === 'DELETE' && /^\/api\/study-groups\/[^/]+\/notes\/[^/]+$/.test(url.pathname)) {
    const parts = url.pathname.split('/');
    const group = groupMemberOr404(findStudyGroup(parts[3]), req.auth);
    if (!group) return send(res, 404, { error: 'Study group not found.' });
    const note = (store.groupNotes || []).find(n => n.id === parts[5] && n.groupId === group.id);
    if (!note) return send(res, 404, { error: 'Note not found.' });
    if (note.authorId !== req.auth.id && !studygroups.canModerate(group, req.auth.id) && !org.isAdminRole(req.auth.role)) return send(res, 403, { error: 'Only the author or a group admin can delete this note.' });
    store.groupNotes = store.groupNotes.filter(n => n.id !== note.id);
    await persist();
    return send(res, 200, { deleted: true });
  }
  if (req.method === 'GET' && /^\/api\/study-groups\/[^/]+\/messages$/.test(url.pathname)) {
    const group = groupMemberOr404(findStudyGroup(url.pathname.split('/')[3]), req.auth);
    if (!group) return send(res, 404, { error: 'Study group not found.' });
    const msgs = (store.groupMessages || []).filter(m => m.groupId === group.id)
      .sort((a, b) => String(a.createdAt || '').localeCompare(String(b.createdAt || '')))
      .slice(-studygroups.MAX_MESSAGES_PER_GROUP);
    return send(res, 200, { messages: msgs });
  }
  if (req.method === 'POST' && /^\/api\/study-groups\/[^/]+\/messages$/.test(url.pathname)) return readBody(req).then(async body => {
    const group = groupMemberOr404(findStudyGroup(url.pathname.split('/')[3]), req.auth);
    if (!group) return send(res, 404, { error: 'Study group not found.' });
    if (!consumeRate(groupMsgAttempts, req.auth.id, 30, 60 * 1000)) return send(res, 429, { error: 'Too many messages. Wait a minute and try again.' });
    let input;
    try { input = studygroups.validateMessageInput(body); } catch (e) { return send(res, 400, { error: e.message }); }
    const msg = { id: randomUUID(), groupId: group.id, authorId: req.auth.id, authorName: req.auth.name,
      text: input.text, createdAt: new Date().toISOString() };
    store.groupMessages.push(msg);
    const kept = (store.groupMessages || []).filter(m => m.groupId === group.id).slice(-studygroups.MAX_MESSAGES_PER_GROUP);
    store.groupMessages = (store.groupMessages || []).filter(m => m.groupId !== group.id).concat(kept);
    await persist();
    send(res, 201, { message: msg });
  }).catch(e => send(res, 400, { error: e.message }));
  // ---- Virtual classroom gaps (slice 3): Agora provider + attendance + upcoming ----
  if (req.method === 'GET' && url.pathname === '/api/settings/video-provider') {
    const cfg=classroom.providerConfig();
    return send(res,200,{provider:cfg.provider,agoraConfigured:cfg.agoraConfigured});
  }
  if (req.method === 'POST' && url.pathname === '/api/live/token') return readBody(req).then(async body=>{
    const cfg=classroom.providerConfig();
    if(!cfg.agoraConfigured)return send(res,501,{error:'Agora is not configured. Set VIDEO_PROVIDER=agora with AGORA_APP_ID and AGORA_APP_CERT.'});
    const channel=String(body.channel||'').trim();
    const role=classroom.normalizeRole(body.role===undefined?'publisher':body.role);
    if(!role)return send(res,400,{error:'role must be publisher or subscriber.'});
    const uid=classroom.uidForUser(req.auth.id);
    try{
      const built=classroom.buildToken(cfg.appId,cfg.appCertificate,channel,uid,role,{expireInSec:body.expireInSec});
      return send(res,200,{token:built.token,appId:cfg.appId,channel,uid,role:built.role,expiresAt:built.expiresAt});
    }catch(e){return send(res,400,{error:e.message});}
  }).catch(e=>send(res,400,{error:e.message}));
  if (req.method === 'GET' && /^\/api\/teacher\/live-sessions\/[^/]+\/attendance$/.test(url.pathname)) {
    const s=(store.liveSessions||[]).find(x=>x.id===url.pathname.split('/')[4]);
    if(!s||(s.ownerId!==req.auth.id&&!org.isAdminRole(req.auth.role)))return send(res,404,{error:'Live session not found.'});
    const attendees=(s.attendance||[]).map(a=>({userId:a.userId,name:a.name||(store.users.find(u=>u.id===a.userId)||{}).name||'Participant',joinedAt:a.joinedAt}));
    for(const uid of (s.attendees||[])){
      if(!attendees.some(a=>a.userId===uid)){
        const u=store.users.find(x=>x.id===uid);
        attendees.push({userId:uid,name:u?u.name:'Participant',joinedAt:null});
      }
    }
    const present=attendees.length;
    const total=s.courseId?(store.enrollments||[]).filter(e=>e.courseId===s.courseId).length:present;
    return send(res,200,{session:{id:s.id,title:s.title,startsAt:s.startsAt,durationMin:s.durationMin,status:s.status,courseId:s.courseId||null},attendees,present,total});
  }
  if (req.method === 'GET' && url.pathname === '/api/live-sessions/upcoming') {
    const now=Date.now(),horizon=now+60*60*1000;
    const startsMs=s=>new Date(s.startsAt).getTime();
    let list=(store.liveSessions||[]).filter(s=>['scheduled','live'].includes(s.status));
    list=list.filter(s=>{const t=startsMs(s);return Number.isFinite(t)&&t>=now&&t<=horizon;});
    if(req.auth.role==='student'){
      const enrolled=new Set((store.enrollments||[]).filter(e=>e.studentId===req.auth.id).map(e=>e.courseId));
      list=list.filter(s=>!s.courseId||enrolled.has(s.courseId)||((store.courses||[]).find(c=>c.id===s.courseId)||{}).status==='published');
    }else if(req.auth.role==='teacher'){
      list=list.filter(s=>s.ownerId===req.auth.id);
    }
    list=[...list].sort((a,b)=>startsMs(a)-startsMs(b));
    return send(res,200,{sessions:list.map(({meetingUrl,...s})=>({...s,attendeeCount:(s.attendees||[]).length}))});
  }
  // ---- Gamification ----
  if (req.method === 'GET' && url.pathname === '/api/gamification') {
    const rec=xpForUser(req.auth.id),level=rec.level||1;
    const badges=badgeListFor(req.auth.id).map(b=>{const def=BADGES.find(d=>d.id===b.badgeId)||{name:b.badgeId,description:''};return {badgeId:b.badgeId,name:def.name,description:def.description,awardedAt:b.awardedAt};});
    return send(res,200,{xp:rec.xp||0,level,streakDays:rec.streakDays||0,badges,nextLevelXp:level*level*100});
  }
  if (req.method === 'GET' && url.pathname === '/api/leaderboard') {
    const ranked=Object.entries(store.userXp||{}).map(([userId,rec])=>{const u=store.users.find(x=>x.id===userId);if(!u||u.role==='admin')return null;const xp=Number(rec.xp)||0;return {userId,name:u.name,xp,level:xpLevelFor(xp)};}).filter(Boolean).sort((a,b)=>b.xp-a.xp||a.name.localeCompare(b.name));
    const rank=ranked.findIndex(r=>r.userId===req.auth.id);
    return send(res,200,{leaderboard:ranked.slice(0,20),rank:rank<0?null:rank+1});
  }
  // ---- Teacher lesson video fields (create/update) ----
  if (req.method === 'PATCH' && /^\/api\/teacher\/courses\/[^/]+\/modules\/[^/]+\/lessons\/[^/]+$/.test(url.pathname)) return readBody(req).then(async body=>{
    const parts=url.pathname.split('/');
    const course=(store.courses||[]).find(c=>c.id===parts[4]&&(req.auth.role==='admin'||c.ownerId===req.auth.id));
    const mod=course&&course.modules&&course.modules.find(m=>m.id===parts[6]);
    const lesson=mod&&mod.lessons&&mod.lessons.find(l=>l.id===parts[8]);
    if(!lesson)return send(res,404,{error:'Lesson not found.'});
    if(body.title!==undefined){const t=String(body.title).trim();if(t.length<2||t.length>160)return send(res,400,{error:'Lesson title must be 2 to 160 characters.'});lesson.title=t;}
    if(body.content!==undefined)lesson.content=String(body.content).slice(0,4000);
    if(body.videoUrl!==undefined){const v=validateVideoUrl(body.videoUrl);if(!v.ok)return send(res,400,{error:v.error});lesson.videoUrl=v.value||null;lesson.videoType=v.value?detectVideoType(v.value):null;}
    if(body.videoDurationSec!==undefined){const d=Math.floor(Number(body.videoDurationSec)||0);if(d<0||d>86400)return send(res,400,{error:'Video duration must be 0 to 86,400 seconds.'});lesson.videoDurationSec=d;}
    const mediaCheck=validateLessonMedia(body,course,req.auth);if(!mediaCheck.ok)return send(res,400,{error:mediaCheck.error});
    Object.assign(lesson,mediaCheck.fields);
    await persist();send(res,200,{lesson});
  }).catch(e=>send(res,400,{error:e.message}));
  // ================= end LMS expansion =================
  // ----- Library helpers -----
  const needLibraryPerm = () => { if (!org.can(req.auth, 'library.manage')) { send(res, 403, { error: 'Library management is not permitted for your role.' }); return false; } return true; };
  const libraryInstOk = (institutionId) => { const sc = org.orgScope(req.auth); if (sc.institutionId && institutionId && sc.institutionId !== institutionId) { send(res, 403, { error: 'This belongs to another institution.' }); return false; } return true; };
  const libraryAdminOnly = () => { if (!org.isAdminRole(req.auth.role)) { send(res, 403, { error: 'Administrator access required.' }); return false; } return true; };
  const populateReadingList = (rl) => ({ ...rl, items: (rl.itemIds || []).map(id => (store.libraryItems || []).find(i => i.id === id)).filter(Boolean).map(library.publicItem) });

  // ----- Calendar + career center + placement prep (Slice 3) -----
  const needCalendarPerm = () => { if (!org.can(req.auth, 'calendar.manage')) { send(res, 403, { error: 'Calendar management is not permitted for your role.' }); return false; } return true; };
  const careerInstOk = (institutionId) => { const s = org.orgScope(req.auth); if (s.institutionId && institutionId && s.institutionId !== institutionId) { send(res, 403, { error: 'This belongs to another institution.' }); return false; } return true; };
  const careerInstId = (body) => { const s = org.orgScope(req.auth); return s.institutionId || body.institutionId || (store.institutions[0] || {}).id || null; };

  // ----- Calendar events (admin CRUD) -----
  if (req.method === 'POST' && url.pathname === '/api/admin/calendar') return readBody(req).then(async body => {
    if (!needCalendarPerm()) return;
    const v = career.validateCalendarEvent(body, null);
    if (!v.ok) return send(res, 400, { error: v.error });
    const institutionId = careerInstId(body);
    if (body.institutionId && !careerInstOk(body.institutionId)) return;
    const ev = { id: randomUUID(), institutionId, ...v.value, createdBy: req.auth.id, createdAt: new Date().toISOString() };
    store.calendarEvents.unshift(ev);
    audit(req.auth, 'created calendar event', ev.title);
    await persist(); send(res, 201, { event: ev });
  }).catch(e => send(res, 400, { error: e.message }));
  if (req.method === 'GET' && url.pathname === '/api/admin/calendar') {
    if (!needCalendarPerm()) return;
    const s = org.orgScope(req.auth);
    const kind = String(url.searchParams.get('kind') || '').toLowerCase();
    const from = url.searchParams.get('from'), to = url.searchParams.get('to');
    const fromMs = from ? new Date(from).getTime() : null, toMs = to ? new Date(to).getTime() : null;
    const list = (store.calendarEvents || []).filter(e => {
      if (s.institutionId && e.institutionId && e.institutionId !== s.institutionId) return false;
      if (kind && e.kind !== kind) return false;
      const t = new Date(e.startsAt || '').getTime();
      if (fromMs && t < fromMs) return false;
      if (toMs && t > toMs) return false;
      return true;
    }).sort((a, b) => String(a.startsAt || '').localeCompare(String(b.startsAt || '')));
    return send(res, 200, { events: list });
  }
  if ((req.method === 'PATCH' || req.method === 'DELETE') && /^\/api\/admin\/calendar\/[^/]+$/.test(url.pathname)) return readBody(req).then(async body => {
    if (!needCalendarPerm()) return;
    const id = url.pathname.split('/').pop();
    const ev = (store.calendarEvents || []).find(e => e.id === id);
    if (!ev) return send(res, 404, { error: 'Calendar event not found.' });
    if (!careerInstOk(ev.institutionId)) return;
    if (req.method === 'DELETE') {
      store.calendarEvents = (store.calendarEvents || []).filter(e => e.id !== id);
      audit(req.auth, 'deleted calendar event', ev.title);
      await persist(); return send(res, 200, { deleted: true });
    }
    const v = career.validateCalendarEvent(body, ev);
    if (!v.ok) return send(res, 400, { error: v.error });
    Object.assign(ev, v.value);
    audit(req.auth, 'updated calendar event', ev.title);
    await persist(); send(res, 200, { event: ev });
  }).catch(e => send(res, 400, { error: e.message }));

  // ----- Unified calendar: stored events + derived live-session events -----
  if (req.method === 'GET' && url.pathname === '/api/calendar') {
    const s = org.orgScope(req.auth);
    const from = url.searchParams.get('from'), to = url.searchParams.get('to');
    const fromMs = from ? new Date(from).getTime() : null, toMs = to ? new Date(to).getTime() : null;
    const stored = (store.calendarEvents || []).filter(e => {
      if (s.institutionId && e.institutionId && e.institutionId !== s.institutionId) return false;
      const t = new Date(e.startsAt || '').getTime();
      if (fromMs && t < fromMs) return false;
      if (toMs && t > toMs) return false;
      return true;
    }).map(e => ({ ...e, source: 'stored' }));
    const derived = career.derivedEvents(req.auth, fromMs, toMs);
    const all = stored.concat(derived).sort((a, b) => String(a.startsAt || '').localeCompare(String(b.startsAt || '')));
    const loginDays = (store.loginHistory || []).find(h => h.userId === req.auth.id)?.days?.filter(d => /^\d{4}-\d{2}-\d{2}$/.test(d)) || [];
    return send(res, 200, { events: all, loginDays });
  }

  // ----- Career paths -----
  const populateCareerPath = (p) => ({
    ...p,
    courses: (p.courses || []).map(id => {
      const c = (store.courses || []).find(x => x.id === id);
      return c ? { id: c.id, title: c.title || 'Untitled course' } : null;
    }).filter(Boolean),
  });
  if (req.method === 'POST' && url.pathname === '/api/admin/career-paths') return readBody(req).then(async body => {
    if (!needCalendarPerm()) return;
    const v = career.validateCareerPath(body, null);
    if (!v.ok) return send(res, 400, { error: v.error });
    const institutionId = careerInstId(body);
    if (body.institutionId && !careerInstOk(body.institutionId)) return;
    const p = { id: randomUUID(), institutionId, ...v.value, createdBy: req.auth.id, createdAt: new Date().toISOString() };
    store.careerPaths.unshift(p);
    audit(req.auth, 'created career path', p.title);
    await persist(); send(res, 201, { careerPath: populateCareerPath(p) });
  }).catch(e => send(res, 400, { error: e.message }));
  const careerPathList = () => {
    const s = org.orgScope(req.auth);
    return (store.careerPaths || [])
      .filter(p => !s.institutionId || !p.institutionId || p.institutionId === s.institutionId)
      .sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')));
  };
  if (req.method === 'GET' && url.pathname === '/api/admin/career-paths') {
    if (!needCalendarPerm()) return;
    return send(res, 200, { careerPaths: careerPathList().map(populateCareerPath) });
  }
  if (req.method === 'GET' && url.pathname === '/api/career-paths') {
    return send(res, 200, { careerPaths: careerPathList().map(populateCareerPath) });
  }
  if ((req.method === 'PATCH' || req.method === 'DELETE') && /^\/api\/admin\/career-paths\/[^/]+$/.test(url.pathname)) return readBody(req).then(async body => {
    if (!needCalendarPerm()) return;
    const id = url.pathname.split('/').pop();
    const p = (store.careerPaths || []).find(x => x.id === id);
    if (!p) return send(res, 404, { error: 'Career path not found.' });
    if (!careerInstOk(p.institutionId)) return;
    if (req.method === 'DELETE') {
      store.careerPaths = (store.careerPaths || []).filter(x => x.id !== id);
      audit(req.auth, 'deleted career path', p.title);
      await persist(); return send(res, 200, { deleted: true });
    }
    const v = career.validateCareerPath(body, p);
    if (!v.ok) return send(res, 400, { error: v.error });
    Object.assign(p, v.value);
    audit(req.auth, 'updated career path', p.title);
    await persist(); send(res, 200, { careerPath: populateCareerPath(p) });
  }).catch(e => send(res, 400, { error: e.message }));

  // ----- Internships -----
  const internshipList = () => {
    const s = org.orgScope(req.auth);
    return (store.internships || [])
      .filter(i => !s.institutionId || !i.institutionId || i.institutionId === s.institutionId)
      .sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')));
  };
  const publicInternship = (i) => ({
    ...i,
    applications: undefined,
    applicationCount: (i.applications || []).length,
    appliedByMe: req.auth.role === 'student' ? (i.applications || []).some(a => a.studentId === req.auth.id) : undefined,
  });
  if (req.method === 'POST' && url.pathname === '/api/admin/internships') return readBody(req).then(async body => {
    if (!needCalendarPerm()) return;
    const v = career.validateInternship(body, null);
    if (!v.ok) return send(res, 400, { error: v.error });
    const institutionId = careerInstId(body);
    if (body.institutionId && !careerInstOk(body.institutionId)) return;
    const ins = { id: randomUUID(), institutionId, ...v.value, applications: [], postedBy: req.auth.id, createdAt: new Date().toISOString() };
    store.internships.unshift(ins);
    audit(req.auth, 'posted internship', `${ins.company} — ${ins.role}`);
    await persist(); send(res, 201, { internship: publicInternship(ins) });
  }).catch(e => send(res, 400, { error: e.message }));
  if (req.method === 'GET' && url.pathname === '/api/admin/internships') {
    if (!needCalendarPerm()) return;
    return send(res, 200, { internships: internshipList().map(publicInternship) });
  }
  if (req.method === 'GET' && url.pathname === '/api/internships') {
    return send(res, 200, { internships: internshipList().map(publicInternship) });
  }
  if ((req.method === 'PATCH' || req.method === 'DELETE') && /^\/api\/admin\/internships\/[^/]+$/.test(url.pathname)) return readBody(req).then(async body => {
    if (!needCalendarPerm()) return;
    const id = url.pathname.split('/').pop();
    const ins = (store.internships || []).find(x => x.id === id);
    if (!ins) return send(res, 404, { error: 'Internship not found.' });
    if (!careerInstOk(ins.institutionId)) return;
    if (req.method === 'DELETE') {
      store.internships = (store.internships || []).filter(x => x.id !== id);
      audit(req.auth, 'deleted internship', ins.role);
      await persist(); return send(res, 200, { deleted: true });
    }
    const v = career.validateInternship(body, ins);
    if (!v.ok) return send(res, 400, { error: v.error });
    Object.assign(ins, v.value);
    audit(req.auth, 'updated internship', ins.role);
    await persist(); send(res, 200, { internship: publicInternship(ins) });
  }).catch(e => send(res, 400, { error: e.message }));
  if (req.method === 'POST' && /^\/api\/internships\/[^/]+\/apply$/.test(url.pathname)) return readBody(req).then(async body => {
    if (req.auth.role !== 'student') return send(res, 403, { error: 'Student access required.' });
    const id = url.pathname.split('/')[3];
    const ins = (store.internships || []).find(x => x.id === id);
    if (!ins) return send(res, 404, { error: 'Internship not found.' });
    if (!careerInstOk(ins.institutionId)) return;
    if (ins.deadline && new Date(ins.deadline).getTime() < Date.now()) return send(res, 400, { error: 'Applications for this internship have closed.' });
    ins.applications ||= [];
    if (ins.applications.some(a => a.studentId === req.auth.id)) {
      await persist(); return send(res, 200, { applied: true, alreadyApplied: true });
    }
    ins.applications.push({ studentId: req.auth.id, appliedAt: new Date().toISOString() });
    await persist(); send(res, 200, { applied: true, alreadyApplied: false });
  }).catch(e => send(res, 400, { error: e.message }));

  // ----- Aptitude tests (teacher/admin CRUD) — must precede the /api/teacher/* catch-all -----
  const aptitudeVisible = (t) => {
    const s = org.orgScope(req.auth);
    if (s.institutionId && t.institutionId && t.institutionId !== s.institutionId) return false;
    if (org.isAdminRole(req.auth.role)) return true;
    return t.createdBy === req.auth.id;
  };
  if (req.method === 'POST' && url.pathname === '/api/teacher/aptitude') return readBody(req).then(async body => {
    const v = career.validateAptitudeTest(body, null);
    if (!v.ok) return send(res, 400, { error: v.error });
    const t = { id: randomUUID(), institutionId: careerInstId(body), ...v.value, createdBy: req.auth.id, createdAt: new Date().toISOString() };
    store.aptitudeTests.unshift(t);
    audit(req.auth, 'created aptitude test', t.title);
    await persist(); send(res, 201, { test: career.publicAptitudeTest(t, true) });
  }).catch(e => send(res, 400, { error: e.message }));
  if (req.method === 'GET' && url.pathname === '/api/teacher/aptitude') {
    const list = (store.aptitudeTests || []).filter(aptitudeVisible)
      .sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')));
    return send(res, 200, { tests: list.map(t => career.publicAptitudeTest(t, true)) });
  }
  if (req.method === 'GET' && /^\/api\/teacher\/aptitude\/[^/]+$/.test(url.pathname)) {
    const id = url.pathname.split('/').pop();
    const t = (store.aptitudeTests || []).find(x => x.id === id);
    if (!t || !aptitudeVisible(t)) return send(res, 404, { error: 'Aptitude test not found.' });
    return send(res, 200, { test: career.publicAptitudeTest(t, true) });
  }
  if ((req.method === 'PATCH' || req.method === 'DELETE') && /^\/api\/teacher\/aptitude\/[^/]+$/.test(url.pathname)) return readBody(req).then(async body => {
    const id = url.pathname.split('/').pop();
    const t = (store.aptitudeTests || []).find(x => x.id === id);
    if (!t || !aptitudeVisible(t)) return send(res, 404, { error: 'Aptitude test not found.' });
    if (req.method === 'DELETE') {
      store.aptitudeTests = (store.aptitudeTests || []).filter(x => x.id !== id);
      store.aptitudeAttempts = (store.aptitudeAttempts || []).filter(a => a.testId !== id);
      audit(req.auth, 'deleted aptitude test', t.title);
      await persist(); return send(res, 200, { deleted: true });
    }
    const v = career.validateAptitudeTest(body, t);
    if (!v.ok) return send(res, 400, { error: v.error });
    Object.assign(t, v.value);
    audit(req.auth, 'updated aptitude test', t.title);
    await persist(); send(res, 200, { test: career.publicAptitudeTest(t, true) });
  }).catch(e => send(res, 400, { error: e.message }));

  // ----- Aptitude tests (student-facing: answers never leak) -----
  const studentAptitudeScope = (t) => {
    const s = org.orgScope(req.auth);
    return !s.institutionId || !t.institutionId || t.institutionId === s.institutionId;
  };
  if (req.method === 'GET' && url.pathname === '/api/aptitude') {
    const list = (store.aptitudeTests || []).filter(studentAptitudeScope)
      .sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')));
    const out = list.map(t => {
      const mine = (store.aptitudeAttempts || []).filter(a => a.testId === t.id && a.studentId === req.auth.id && a.status === 'graded');
      const best = mine.length ? Math.max(...mine.map(a => a.score || 0)) : null;
      return { ...career.publicAptitudeTest(t, false), attempts: mine.length, bestScore: best };
    });
    return send(res, 200, { tests: out });
  }
  if (req.method === 'POST' && /^\/api\/aptitude\/[^/]+\/start$/.test(url.pathname)) return readBody(req).then(async body => {
    if (req.auth.role !== 'student') return send(res, 403, { error: 'Student access required.' });
    const id = url.pathname.split('/')[3];
    const t = (store.aptitudeTests || []).find(x => x.id === id);
    if (!t || !studentAptitudeScope(t)) return send(res, 404, { error: 'Aptitude test not found.' });
    if (!(t.questions || []).length) return send(res, 400, { error: 'This test has no questions yet.' });
    const prior = (store.aptitudeAttempts || []).filter(a => a.testId === t.id && a.studentId === req.auth.id);
    const live = prior.find(a => a.status === 'in-progress');
    const serverNow = Date.now();
    if (live) {
      return send(res, 200, { attemptId: live.id, startedAt: live.startedAt, serverNow, expiresAt: live.expiresAt, timeMin: t.timeMin || 30, questionCount: t.questions.length, questions: career.publicTestQuestions(t), resumed: true });
    }
    const startedAt = new Date().toISOString();
    const attempt = {
      id: randomUUID(), testId: t.id, studentId: req.auth.id, startedAt,
      expiresAt: new Date(serverNow + (t.timeMin || 30) * 60000).toISOString(),
      submittedAt: null, answers: {}, score: null, total: null, correct: null, passed: false,
      status: 'in-progress', attemptNumber: prior.length + 1, late: false,
    };
    store.aptitudeAttempts.unshift(attempt);
    await persist();
    send(res, 201, { attemptId: attempt.id, startedAt, serverNow, expiresAt: attempt.expiresAt, timeMin: t.timeMin || 30, questionCount: t.questions.length, questions: career.publicTestQuestions(t) });
  }).catch(e => send(res, 400, { error: e.message }));
  if (req.method === 'POST' && /^\/api\/aptitude\/[^/]+\/submit$/.test(url.pathname)) return readBody(req).then(async body => {
    if (req.auth.role !== 'student') return send(res, 403, { error: 'Student access required.' });
    const parts = url.pathname.split('/');
    const t = (store.aptitudeTests || []).find(x => x.id === parts[3]);
    const attempt = (store.aptitudeAttempts || []).find(a => a.id === (body.attemptId || '') && a.testId === parts[3]);
    if (!t || !attempt) return send(res, 404, { error: 'Aptitude attempt not found.' });
    if (attempt.studentId !== req.auth.id) return send(res, 403, { error: 'This attempt belongs to another student.' });
    if (attempt.status !== 'in-progress') return send(res, 400, { error: 'This attempt was already submitted.' });
    const raw = (body.answers && typeof body.answers === 'object' && !Array.isArray(body.answers)) ? body.answers : {};
    const answers = {};
    for (const q of t.questions || []) {
      const g = raw[q.id];
      if (g !== undefined) answers[q.id] = Math.floor(Number(g));
    }
    const grade = career.gradeAptitude(t, answers);
    attempt.answers = answers;
    attempt.submittedAt = new Date().toISOString();
    attempt.score = grade.score; attempt.total = grade.total; attempt.correct = grade.correct;
    attempt.passed = grade.passed; attempt.status = 'graded';
    if (new Date(attempt.expiresAt).getTime() < Date.now()) attempt.late = true;
    await persist();
    send(res, 200, { score: grade.score, total: grade.total, correct: grade.correct, passed: grade.passed, late: attempt.late });
  }).catch(e => send(res, 400, { error: e.message }));

  // ----- Mock interviews — must precede the /api/teacher/* catch-all -----
  const mockVisible = (m) => {
    const s = org.orgScope(req.auth);
    if (s.institutionId && m.institutionId && m.institutionId !== s.institutionId) return false;
    if (org.isAdminRole(req.auth.role)) return true;
    if (req.auth.role === 'teacher') return m.interviewerId === req.auth.id;
    return m.status === 'open' || m.studentId === req.auth.id;
  };
  if (req.method === 'POST' && url.pathname === '/api/teacher/mock-interviews') return readBody(req).then(async body => {
    const v = career.validateMockInterview(body, null);
    if (!v.ok) return send(res, 400, { error: v.error });
    const m = {
      id: randomUUID(), institutionId: careerInstId(body), ...v.value,
      status: 'open', studentId: null, interviewerId: req.auth.id,
      feedback: null, createdAt: new Date().toISOString(),
    };
    store.mockInterviews.unshift(m);
    audit(req.auth, 'created mock interview', m.title);
    await persist(); send(res, 201, { interview: m });
  }).catch(e => send(res, 400, { error: e.message }));
  if (req.method === 'GET' && url.pathname === '/api/teacher/mock-interviews') {
    const list = (store.mockInterviews || []).filter(m => {
      const s = org.orgScope(req.auth);
      if (s.institutionId && m.institutionId && m.institutionId !== s.institutionId) return false;
      if (org.isAdminRole(req.auth.role)) return true;
      return m.interviewerId === req.auth.id;
    }).sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')));
    return send(res, 200, { interviews: list });
  }
  if (req.method === 'POST' && /^\/api\/teacher\/mock-interviews\/[^/]+\/feedback$/.test(url.pathname)) return readBody(req).then(async body => {
    const id = url.pathname.split('/')[4];
    const m = (store.mockInterviews || []).find(x => x.id === id);
    if (!m || (!org.isAdminRole(req.auth.role) && m.interviewerId !== req.auth.id)) return send(res, 404, { error: 'Mock interview not found.' });
    const s = org.orgScope(req.auth);
    if (s.institutionId && m.institutionId && m.institutionId !== s.institutionId) return send(res, 404, { error: 'Mock interview not found.' });
    const feedback = String(body.feedback || '').trim();
    if (feedback.length < 2 || feedback.length > 5000) return send(res, 400, { error: 'Feedback must be 2 to 5,000 characters.' });
    m.feedback = feedback;
    m.status = 'done';
    audit(req.auth, 'graded mock interview', m.title);
    await persist(); send(res, 200, { interview: m });
  }).catch(e => send(res, 400, { error: e.message }));
  if (req.method === 'GET' && url.pathname === '/api/mock-interviews') {
    const list = (store.mockInterviews || []).filter(mockVisible)
      .sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')));
    return send(res, 200, { interviews: list });
  }
  if (req.method === 'POST' && /^\/api\/mock-interviews\/[^/]+\/book$/.test(url.pathname)) return readBody(req).then(async body => {
    if (req.auth.role !== 'student') return send(res, 403, { error: 'Student access required.' });
    const id = url.pathname.split('/')[3];
    const m = (store.mockInterviews || []).find(x => x.id === id);
    const s = org.orgScope(req.auth);
    if (!m || (s.institutionId && m.institutionId && m.institutionId !== s.institutionId)) return send(res, 404, { error: 'Mock interview not found.' });
    if (m.status !== 'open') return send(res, 409, { error: 'This slot is no longer available.' });
    m.status = 'scheduled';
    m.studentId = req.auth.id;
    await persist(); send(res, 200, { interview: m });
  }).catch(e => send(res, 400, { error: e.message }));
  if (req.method === 'POST' && /^\/api\/mock-interviews\/[^/]+\/cancel$/.test(url.pathname)) return readBody(req).then(async body => {
    if (req.auth.role !== 'student') return send(res, 403, { error: 'Student access required.' });
    const id = url.pathname.split('/')[3];
    const m = (store.mockInterviews || []).find(x => x.id === id);
    if (!m || m.studentId !== req.auth.id) return send(res, 404, { error: 'Mock interview booking not found.' });
    if (m.status !== 'scheduled') return send(res, 400, { error: 'Only scheduled interviews can be cancelled.' });
    m.status = 'open';
    m.studentId = null;
    await persist(); send(res, 200, { interview: m });
  }).catch(e => send(res, 400, { error: e.message }));

  // ----- Reading lists (teacher) — must precede the /api/teacher/* catch-all -----

  // ----- Language learning: vocab sets + speaking exercises (Slice 4) -----
  const langInstId = (body) => { const s = org.orgScope(req.auth); return s.institutionId || body.institutionId || (store.institutions[0] || {}).id || null; };
  const vocabVisible = (v) => {
    const s = org.orgScope(req.auth);
    if (s.institutionId && v.institutionId && v.institutionId !== s.institutionId) return false;
    if (org.isAdminRole(req.auth.role)) return true;
    return v.createdBy === req.auth.id;
  };
  const vocabScope = (v) => {
    const s = org.orgScope(req.auth);
    return !s.institutionId || !v.institutionId || v.institutionId === s.institutionId;
  };
  // Admin/teacher vocab CRUD (teachers reach this via the /api/admin/ gate carve-out).
  if (req.method === 'POST' && url.pathname === '/api/admin/vocab') return readBody(req).then(async body => {
    const v = lang.validateVocabSet(body, null);
    if (!v.ok) return send(res, 400, { error: v.error });
    const item = { id: randomUUID(), institutionId: langInstId(body), ...v.value, createdBy: req.auth.id, createdAt: new Date().toISOString() };
    store.vocabSets.unshift(item);
    audit(req.auth, 'created vocab set', item.title);
    await persist(); send(res, 201, { vocabSet: lang.publicVocabSet(item, true) });
  }).catch(e => send(res, 400, { error: e.message }));
  if (req.method === 'GET' && url.pathname === '/api/admin/vocab') {
    const list = (store.vocabSets || []).filter(vocabVisible)
      .sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')));
    return send(res, 200, { vocabSets: list.map(s => lang.publicVocabSet(s, false)) });
  }
  if ((req.method === 'PATCH' || req.method === 'DELETE') && /^\/api\/admin\/vocab\/[^/]+$/.test(url.pathname)) return readBody(req).then(async body => {
    const id = url.pathname.split('/').pop();
    const item = (store.vocabSets || []).find(x => x.id === id);
    if (!item || !vocabVisible(item)) return send(res, 404, { error: 'Vocabulary set not found.' });
    if (req.method === 'DELETE') {
      store.vocabSets = (store.vocabSets || []).filter(x => x.id !== id);
      store.vocabAttempts = (store.vocabAttempts || []).filter(a => a.setId !== id);
      audit(req.auth, 'deleted vocab set', item.title);
      await persist(); return send(res, 200, { deleted: true });
    }
    const v = lang.validateVocabSet(body, item);
    if (!v.ok) return send(res, 400, { error: v.error });
    Object.assign(item, v.value);
    audit(req.auth, 'updated vocab set', item.title);
    await persist(); send(res, 200, { vocabSet: lang.publicVocabSet(item, true) });
  }).catch(e => send(res, 400, { error: e.message }));
  // Student-facing vocab list (meanings included: they are the study material).
  if (req.method === 'GET' && url.pathname === '/api/vocab') {
    const list = (store.vocabSets || []).filter(vocabScope)
      .sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')));
    const out = list.map(s => {
      const mine = (store.vocabAttempts || []).filter(a => a.setId === s.id && a.studentId === req.auth.id && a.status === 'graded');
      const best = mine.length ? Math.max(...mine.map(a => a.score || 0)) : null;
      return { ...lang.publicVocabSet(s, true), attempts: mine.length, bestScore: best };
    });
    return send(res, 200, { vocabSets: out });
  }
  if (req.method === 'POST' && /^\/api\/vocab\/[^/]+\/start$/.test(url.pathname)) return readBody(req).then(async body => {
    if (req.auth.role !== 'student') return send(res, 403, { error: 'Student access required.' });
    const id = url.pathname.split('/')[3];
    const s = (store.vocabSets || []).find(x => x.id === id);
    if (!s || !vocabScope(s)) return send(res, 404, { error: 'Vocabulary set not found.' });
    if (!(s.words || []).length) return send(res, 400, { error: 'This set has no words yet.' });
    const prior = (store.vocabAttempts || []).filter(a => a.setId === s.id && a.studentId === req.auth.id);
    const attempt = {
      id: randomUUID(), setId: s.id, studentId: req.auth.id, startedAt: new Date().toISOString(),
      submittedAt: null, answers: {}, score: null, total: null, correct: null, passed: false,
      status: 'in-progress', attemptNumber: prior.length + 1,
    };
    store.vocabAttempts.unshift(attempt);
    await persist();
    send(res, 201, { attemptId: attempt.id, startedAt: attempt.startedAt, wordCount: s.words.length, words: lang.publicVocabSet(s, true).words });
  }).catch(e => send(res, 400, { error: e.message }));
  if (req.method === 'POST' && /^\/api\/vocab\/[^/]+\/submit$/.test(url.pathname)) return readBody(req).then(async body => {
    if (req.auth.role !== 'student') return send(res, 403, { error: 'Student access required.' });
    const parts = url.pathname.split('/');
    const s = (store.vocabSets || []).find(x => x.id === parts[3]);
    const attempt = (store.vocabAttempts || []).find(a => a.id === (body.attemptId || '') && a.setId === parts[3]);
    if (!s || !attempt) return send(res, 404, { error: 'Vocabulary attempt not found.' });
    if (attempt.studentId !== req.auth.id) return send(res, 403, { error: 'This attempt belongs to another student.' });
    if (attempt.status !== 'in-progress') return send(res, 400, { error: 'This attempt was already submitted.' });
    const raw = (body.answers && typeof body.answers === 'object' && !Array.isArray(body.answers)) ? body.answers : {};
    const answers = {};
    for (const w of s.words || []) {
      const g = raw[w.id];
      if (g !== undefined) answers[w.id] = String(g);
    }
    const grade = lang.gradeVocab(s, answers);
    attempt.answers = answers;
    attempt.submittedAt = new Date().toISOString();
    attempt.score = grade.score; attempt.total = grade.total; attempt.correct = grade.correct;
    attempt.passed = grade.passed; attempt.status = 'graded';
    await persist();
    send(res, 200, { score: grade.score, total: grade.total, correct: grade.correct, passed: grade.passed });
  }).catch(e => send(res, 400, { error: e.message }));
  // Admin/teacher speaking CRUD (teachers reach this via the /api/admin/ gate carve-out).
  if (req.method === 'POST' && url.pathname === '/api/admin/speaking') return readBody(req).then(async body => {
    const v = lang.validateSpeakingExercise(body, null);
    if (!v.ok) return send(res, 400, { error: v.error });
    const item = { id: randomUUID(), institutionId: langInstId(body), ...v.value, createdBy: req.auth.id, createdAt: new Date().toISOString() };
    store.speakingExercises.unshift(item);
    audit(req.auth, 'created speaking exercise', item.title);
    await persist(); send(res, 201, { exercise: lang.publicSpeakingExercise(item) });
  }).catch(e => send(res, 400, { error: e.message }));
  if (req.method === 'GET' && url.pathname === '/api/admin/speaking') {
    const list = (store.speakingExercises || []).filter(vocabVisible)
      .sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')));
    return send(res, 200, { exercises: list.map(e => lang.publicSpeakingExercise(e)) });
  }
  if ((req.method === 'PATCH' || req.method === 'DELETE') && /^\/api\/admin\/speaking\/[^/]+$/.test(url.pathname)) return readBody(req).then(async body => {
    const id = url.pathname.split('/').pop();
    const item = (store.speakingExercises || []).find(x => x.id === id);
    if (!item || !vocabVisible(item)) return send(res, 404, { error: 'Speaking exercise not found.' });
    if (req.method === 'DELETE') {
      store.speakingExercises = (store.speakingExercises || []).filter(x => x.id !== id);
      store.speakingAttempts = (store.speakingAttempts || []).filter(a => a.exerciseId !== id);
      audit(req.auth, 'deleted speaking exercise', item.title);
      await persist(); return send(res, 200, { deleted: true });
    }
    const v = lang.validateSpeakingExercise(body, item);
    if (!v.ok) return send(res, 400, { error: v.error });
    Object.assign(item, v.value);
    audit(req.auth, 'updated speaking exercise', item.title);
    await persist(); send(res, 200, { exercise: lang.publicSpeakingExercise(item) });
  }).catch(e => send(res, 400, { error: e.message }));
  // Student-facing speaking list + submit.
  if (req.method === 'GET' && url.pathname === '/api/speaking') {
    const list = (store.speakingExercises || []).filter(vocabScope)
      .sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')));
    const out = list.map(e => {
      const mine = (store.speakingAttempts || []).filter(a => a.exerciseId === e.id && a.studentId === req.auth.id);
      const best = mine.length ? Math.max(...mine.map(a => a.score || 0)) : null;
      return { ...lang.publicSpeakingExercise(e), attempts: mine.length, bestScore: best };
    });
    return send(res, 200, { exercises: out });
  }
  if (req.method === 'POST' && /^\/api\/speaking\/[^/]+\/submit$/.test(url.pathname)) return readBody(req).then(async body => {
    if (req.auth.role !== 'student') return send(res, 403, { error: 'Student access required.' });
    const id = url.pathname.split('/')[3];
    const e = (store.speakingExercises || []).find(x => x.id === id);
    if (!e || !vocabScope(e)) return send(res, 404, { error: 'Speaking exercise not found.' });
    const transcript = String(body.transcript || '').trim();
    if (!transcript || transcript.length > 2000) return send(res, 400, { error: 'Provide a transcript of 1 to 2000 characters.' });
    const score = lang.scoreSpeaking(e.targetPhrase, transcript);
    const attempt = { id: randomUUID(), exerciseId: e.id, studentId: req.auth.id, transcript, score: score.score, matched: score.matched, total: score.total, completedAt: new Date().toISOString() };
    store.speakingAttempts.unshift(attempt);
    await persist();
    send(res, 200, { score: score.score, matched: score.matched, total: score.total, attemptId: attempt.id });
  }).catch(e => send(res, 400, { error: e.message }));
  // UI language preference (any signed-in user).
  if (req.method === 'GET' && url.pathname === '/api/profile/language') {
    const user = store.users.find(u => u.id === req.auth.id);
    return send(res, 200, { lang: user && user.uiLang ? user.uiLang : 'en' });
  }
  if (req.method === 'POST' && url.pathname === '/api/profile/language') return readBody(req).then(async body => {
    const user = store.users.find(u => u.id === req.auth.id);
    if (!user) return send(res, 401, { error: 'Sign in required.' });
    const l = lang.validateUiLang(body.lang);
    if (!l) return send(res, 400, { error: 'Language must be one of: ' + lang.UI_LANGS.join(', ') + '.' });
    user.uiLang = l;
    await persist(); send(res, 200, { lang: l });
  }).catch(e => send(res, 400, { error: e.message }));

  // ----- Coding Lab (slice 1): code execution, projects, challenges -----
  // Must precede the /api/teacher/* catch-all (POST /api/teacher/ at the end).
  const codeLabInstId = (body) => { const sc = org.orgScope(req.auth); return sc.institutionId || (body && body.institutionId) || (store.institutions[0] || {}).id || null; };
  const challengeVisible = (c) => {
    const sc = org.orgScope(req.auth);
    if (sc.institutionId && c.institutionId && c.institutionId !== sc.institutionId) return false;
    if (org.isAdminRole(req.auth.role)) return true;
    return c.createdBy === req.auth.id;
  };
  const challengeScope = (c) => { const sc = org.orgScope(req.auth); return !sc.institutionId || !c.institutionId || c.institutionId === sc.institutionId; };

  // Execute code: Judge0 when configured, local JS sandbox otherwise.
  if (req.method === 'POST' && url.pathname === '/api/code/run') return readBody(req).then(async body => {
    if (!consumeRate(codeRunAttempts, req.auth.id, 20, 60000)) return send(res, 429, { error: 'Too many code runs. Wait a minute and try again.' });
    if (CODE_EXEC_DISABLED) return send(res, 503, { error: CODE_EXEC_DISABLED_MESSAGE });
    const r = await codelab.runCode({ language: body.language, code: body.code, stdin: body.stdin });
    if (!r.ok) return send(res, r.statusCode || 400, { error: r.error });
    send(res, 200, { stdout: r.stdout, stderr: r.stderr, status: r.status, provider: r.provider, language: String(body.language || '').toLowerCase() });
  }).catch(e => send(res, 400, { error: e.message }));

  // Code projects: owned by the requesting student/teacher (studentId holds the owner id).
  if (req.method === 'GET' && url.pathname === '/api/code/projects') {
    if (!['student', 'teacher'].includes(req.auth.role)) return send(res, 403, { error: 'Student access required.' });
    const list = (store.codeProjects || []).filter(pr => pr.studentId === req.auth.id)
      .sort((a, b) => String(b.updatedAt || '').localeCompare(String(a.updatedAt || '')));
    return send(res, 200, { projects: list.map(codelab.publicProject), languages: codelab.LANGUAGE_IDS });
  }
  if (req.method === 'POST' && url.pathname === '/api/code/projects') return readBody(req).then(async body => {
    if (!['student', 'teacher'].includes(req.auth.role)) return send(res, 403, { error: 'Student access required.' });
    const v = codelab.validateProject(body, null);
    if (!v.ok) return send(res, 400, { error: v.error });
    const now = new Date().toISOString();
    const pr = { id: randomUUID(), studentId: req.auth.id, ...v.value, createdAt: now, updatedAt: now };
    store.codeProjects.unshift(pr);
    await persist(); send(res, 201, { project: codelab.publicProject(pr) });
  }).catch(e => send(res, 400, { error: e.message }));
  if ((req.method === 'PATCH' || req.method === 'DELETE') && /^\/api\/code\/projects\/[^/]+$/.test(url.pathname)) return readBody(req).then(async body => {
    const id = url.pathname.split('/').pop();
    const pr = (store.codeProjects || []).find(x => x.id === id);
    if (!pr || pr.studentId !== req.auth.id) return send(res, 404, { error: 'Project not found.' });
    if (req.method === 'DELETE') {
      store.codeProjects = (store.codeProjects || []).filter(x => x.id !== id);
      await persist(); return send(res, 200, { deleted: true });
    }
    const v = codelab.validateProject(body, pr);
    if (!v.ok) return send(res, 400, { error: v.error });
    Object.assign(pr, v.value, { updatedAt: new Date().toISOString() });
    await persist(); send(res, 200, { project: codelab.publicProject(pr) });
  }).catch(e => send(res, 400, { error: e.message }));

  // Coding challenges: teacher/admin CRUD (teachers see only their own; admins see their institution).
  if (req.method === 'POST' && url.pathname === '/api/teacher/challenges') return readBody(req).then(async body => {
    const v = codelab.validateChallenge(body, null);
    if (!v.ok) return send(res, 400, { error: v.error });
    const item = { id: randomUUID(), institutionId: codeLabInstId(body), ...v.value, createdBy: req.auth.id, createdAt: new Date().toISOString() };
    store.codeChallenges.unshift(item);
    audit(req.auth, 'created coding challenge', item.title);
    await persist(); send(res, 201, { challenge: codelab.publicChallenge(item, true) });
  }).catch(e => send(res, 400, { error: e.message }));
  if (req.method === 'GET' && url.pathname === '/api/teacher/challenges') {
    const list = (store.codeChallenges || []).filter(challengeVisible)
      .sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')));
    return send(res, 200, { challenges: list.map(c => codelab.publicChallenge(c, true)) });
  }
  if ((req.method === 'PATCH' || req.method === 'DELETE') && /^\/api\/teacher\/challenges\/[^/]+$/.test(url.pathname)) return readBody(req).then(async body => {
    const id = url.pathname.split('/').pop();
    const item = (store.codeChallenges || []).find(x => x.id === id);
    if (!item || !challengeVisible(item)) return send(res, 404, { error: 'Coding challenge not found.' });
    if (req.method === 'DELETE') {
      store.codeChallenges = (store.codeChallenges || []).filter(x => x.id !== id);
      store.codeAttempts = (store.codeAttempts || []).filter(a => a.challengeId !== id);
      audit(req.auth, 'deleted coding challenge', item.title);
      await persist(); return send(res, 200, { deleted: true });
    }
    const v = codelab.validateChallenge(body, item);
    if (!v.ok) return send(res, 400, { error: v.error });
    Object.assign(item, v.value);
    audit(req.auth, 'updated coding challenge', item.title);
    await persist(); send(res, 200, { challenge: codelab.publicChallenge(item, true) });
  }).catch(e => send(res, 400, { error: e.message }));

  // Student-facing challenge list (test cases included: visible by design).
  if (req.method === 'GET' && url.pathname === '/api/code/challenges') {
    const list = (store.codeChallenges || []).filter(challengeScope)
      .sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')));
    const out = list.map(c => {
      const mine = (store.codeAttempts || []).filter(a => a.challengeId === c.id && a.studentId === req.auth.id);
      const best = mine.length ? Math.max(...mine.map(a => a.passed || 0)) : null;
      return { ...codelab.publicChallenge(c, true), attempts: mine.length, bestScore: best };
    });
    return send(res, 200, { challenges: out });
  }
  if (req.method === 'POST' && /^\/api\/code\/challenges\/[^/]+\/submit$/.test(url.pathname)) return readBody(req).then(async body => {
    if (req.auth.role !== 'student') return send(res, 403, { error: 'Student access required.' });
    const id = url.pathname.split('/')[4];
    const c = (store.codeChallenges || []).find(x => x.id === id);
    if (!c || !challengeScope(c)) return send(res, 404, { error: 'Coding challenge not found.' });
    const language = String(body.language || c.language || '').toLowerCase();
    if (language !== c.language) return send(res, 400, { error: 'This challenge is in ' + (codelab.LANGUAGES[c.language] || {}).label + '.' });
    const code = body.code;
    if (typeof code !== 'string' || !code.length || code.length > codelab.MAX_CODE_LEN) return send(res, 400, { error: 'Code must be 1 to 65536 characters.' });
    const cases = (c.testCases || []).slice(0, 20);
    if (peekRate(codeRunAttempts, req.auth.id, 60000) + cases.length > 20) return send(res, 429, { error: 'Too many code runs. Wait a minute and try again.' });
    for (let i = 0; i < cases.length; i++) consumeRate(codeRunAttempts, req.auth.id, 20, 60000);
    const grade = await codelab.gradeChallenge(c, language, code);
    const attempt = { id: randomUUID(), challengeId: c.id, studentId: req.auth.id, language, code: code.slice(0, codelab.MAX_CODE_LEN), results: grade.results, passed: grade.passed, total: grade.total, submittedAt: new Date().toISOString() };
    store.codeAttempts.unshift(attempt);
    await persist();
    send(res, 200, { attemptId: attempt.id, passed: grade.passed, total: grade.total, results: grade.results });
  }).catch(e => send(res, 400, { error: e.message }));

  // ----- Standards (Slice 5): LTI consumers, SCORM, xAPI, PDF/XLS exports -----
  const stdNeedPerm = (perm) => { if (!org.can(req.auth, perm)) { send(res, 403, { error: 'Not permitted for your role.' }); return false; } return true; };
  const stdInstId = (body) => { const s = org.orgScope(req.auth); return s.institutionId || (body && body.institutionId) || (store.institutions[0] || {}).id || null; };
  const stdInScope = (item) => { const s = org.orgScope(req.auth); return !s.institutionId || !item.institutionId || item.institutionId === s.institutionId; };

  // LTI 1.1 consumers (tool consumers that may launch into EduVerse).
  if (req.method === 'GET' && url.pathname === '/api/admin/lti/consumers') {
    if (!stdNeedPerm('standards.manage')) return;
    return send(res, 200, { consumers: (store.ltiConsumers || []).filter(stdInScope).map(standards.publicLtiConsumer) });
  }
  if (req.method === 'POST' && url.pathname === '/api/admin/lti/consumers') return readBody(req).then(async body => {
    if (!stdNeedPerm('standards.manage')) return;
    const institutionId = stdInstId(body);
    if (!institutionId) return send(res, 400, { error: 'Choose an institution.' });
    const v = standards.validateLtiConsumer(body, null);
    if (!v.ok) return send(res, 400, { error: v.error });
    const course = (store.courses || []).find(c => c.id === v.value.courseId);
    if (!stdInScope({ institutionId: course.institutionId })) return send(res, 403, { error: 'Course belongs to another institution.' });
    const creds = standards.newLtiCredentials();
    const consumer = { id: randomUUID(), institutionId, key: creds.key, secret: creds.secret, label: v.value.label, courseId: v.value.courseId, launchCount: 0, createdAt: new Date().toISOString(), createdBy: req.auth.id };
    store.ltiConsumers.unshift(consumer);
    audit(req.auth, 'created LTI consumer', consumer.label);
    await persist();
    // The secret is returned ONLY here — never by GET.
    send(res, 201, { consumer: { ...standards.publicLtiConsumer(consumer), secret: creds.secret }, secretShownOnce: true });
  }).catch(e => send(res, 400, { error: e.message }));
  if (req.method === 'DELETE' && /^\/api\/admin\/lti\/consumers\/[^/]+$/.test(url.pathname)) {
    if (!stdNeedPerm('standards.manage')) return;
    const id = url.pathname.split('/').pop();
    const ix = (store.ltiConsumers || []).findIndex(c => c.id === id && stdInScope(c));
    if (ix < 0) return send(res, 404, { error: 'Consumer not found.' });
    const [gone] = store.ltiConsumers.splice(ix, 1);
    audit(req.auth, 'deleted LTI consumer', gone.label);
    await persist();
    return send(res, 200, { deleted: true });
  }

  // SCORM package import (multipart zip OR {filename, data: base64} JSON).
  if (req.method === 'POST' && url.pathname === '/api/admin/scorm/import') {
    if (!stdNeedPerm('standards.manage')) return;
    const ct = String(req.headers['content-type'] || '');
    let zipBuffer = null, filename = 'package.zip', courseId = null, title = '';
    try {
      if (ct.includes('multipart/form-data')) {
        const raw = await readRawBody(req, 50 * 1024 * 1024);
        const mp = parseMultipart(raw, ct);
        const file = mp.files.find(f => f.field === 'package' || f.field === 'file') || mp.files[0];
        if (!file || !file.data.length) return send(res, 400, { error: 'No zip file in the upload.' });
        zipBuffer = file.data; filename = file.filename || filename;
        courseId = mp.fields.courseId || null; title = String(mp.fields.title || '');
      } else {
        const body = await readBody(req);
        if (!body.data) return send(res, 400, { error: 'Provide multipart file or {filename, data (base64), courseId?, title?}.' });
        zipBuffer = Buffer.from(String(body.data), 'base64');
        filename = String(body.filename || filename).slice(0, 120);
        courseId = body.courseId || null; title = String(body.title || '');
      }
    } catch (e) { return send(res, 400, { error: e.message }); }
    if (!zipBuffer || !zipBuffer.length) return send(res, 400, { error: 'Empty file.' });
    let entries;
    try { entries = standards.parseZip(zipBuffer); }
    catch (e) { return send(res, 400, { error: 'Invalid SCORM package: ' + e.message }); }
    const manifestEntry = entries.find(e => /(^|\/)imsmanifest\.xml$/i.test(e.name));
    if (!manifestEntry) return send(res, 400, { error: 'Package has no imsmanifest.xml at its root.' });
    let manifest;
    try { manifest = standards.parseScormManifest(manifestEntry.data.toString('utf8')); }
    catch (e) { return send(res, 400, { error: 'Invalid manifest: ' + e.message }); }
    const launchable = manifest.items.filter(i => i.href);
    if (!launchable.length) return send(res, 400, { error: 'Manifest has no items with launch URLs.' });
    const institutionId = stdInstId({});
    if (!institutionId) return send(res, 400, { error: 'No institution available.' });
    let course = courseId ? (store.courses || []).find(c => c.id === courseId) : null;
    if (courseId && !course) return send(res, 404, { error: 'Course not found.' });
    if (course && !stdInScope({ institutionId: course.institutionId })) return send(res, 403, { error: 'Course belongs to another institution.' });
    // Extract package files to disk for the iframe player.
    const pkgId = randomUUID();
    try {
      const destDir = path.join(storage.UPLOAD_DIR, 'scorm', pkgId);
      fs.mkdirSync(destDir, { recursive: true });
      for (const e of entries) {
        const dest = path.normalize(path.join(destDir, e.name));
        if (!dest.startsWith(destDir + path.sep) && dest !== destDir) continue;
        fs.mkdirSync(path.dirname(dest), { recursive: true });
        fs.writeFileSync(dest, e.data, { mode: 0o600 });
      }
    } catch (e) { return send(res, 500, { error: 'Could not store package files.' }); }
    if (!course) {
      const courseTitle = (title || manifest.title || filename.replace(/\.zip$/i, '')).slice(0, 120) || 'SCORM course';
      if (courseTitle.length < 3) return send(res, 400, { error: 'Give the course a title of at least 3 characters.' });
      course = { id: randomUUID(), title: courseTitle, category: 'SCORM import', description: ('Imported from SCORM package ' + filename).slice(0, 2000), duration: 'Self-paced', level: 'Beginner', icon: '✦', ownerId: req.auth.id, status: 'draft', priceCents: 0, currency: 'INR', learningObjectives: [], prerequisites: [], modules: [], institutionId, campusId: null, departmentId: null, semesterId: null, createdAt: new Date().toISOString() };
      store.courses.unshift(course);
    }
    course.modules ||= [];
    const mod = { id: randomUUID(), name: ('SCORM: ' + (manifest.title || 'package')).slice(0, 120), order: course.modules.length, lessons: [] };
    const pkgItems = [];
    for (const item of launchable) {
      const lesson = { id: randomUUID(), title: item.title, content: 'SCORM activity: ' + item.title, kind: 'scorm', scormHref: item.href, scormPackageId: pkgId, createdAt: new Date().toISOString() };
      mod.lessons ||= [];
      mod.lessons.push(lesson);
      pkgItems.push({ identifier: item.identifier, title: item.title, href: item.href, lessonId: lesson.id });
    }
    course.modules.push(mod);
    const pkg = { id: pkgId, institutionId, courseId: course.id, moduleId: mod.id, title: (manifest.title || course.title).slice(0, 160), manifest: manifestEntry.data.toString('utf8').slice(0, 20000), items: pkgItems, fileCount: entries.length, uploadedAt: new Date().toISOString(), uploadedBy: req.auth.id };
    store.scormPackages.unshift(pkg);
    audit(req.auth, 'imported SCORM package', pkg.title);
    await persist();
    if (typeof search !== 'undefined' && search.scheduleRebuild) search.scheduleRebuild();
    send(res, 201, { package: standards.publicScormPackage(pkg), courseId: course.id, lessonsCreated: pkgItems.length });
  }
  if (req.method === 'GET' && url.pathname === '/api/scorm/packages') {
    const role = org.effectiveRole(req.auth.role);
    if (!['super_admin', 'institution_admin', 'admin', 'teacher'].includes(role) && !org.can(req.auth, 'standards.manage'))
      return send(res, 403, { error: 'Not permitted for your role.' });
    return send(res, 200, { packages: (store.scormPackages || []).filter(stdInScope).map(standards.publicScormPackage) });
  }
  // SCORM runtime commit: student reports cmi.core.lesson_status for a SCORM lesson.
  if (req.method === 'POST' && /^\/api\/scorm\/[^/]+\/commit$/.test(url.pathname)) {
    if (req.auth.role !== 'student') return send(res, 403, { error: 'Student access required.' });
    const lessonId = url.pathname.split('/')[3];
    const course = (store.courses || []).find(c => (c.modules || []).some(m => (m.lessons || []).some(l => l.id === lessonId && l.kind === 'scorm')));
    if (!course) return send(res, 404, { error: 'SCORM lesson not found.' });
    if (!(store.enrollments || []).some(e => e.studentId === req.auth.id && e.courseId === course.id))
      return send(res, 403, { error: 'Enroll in the course first.' });
    const body = await readBody(req).catch(() => ({}));
    const status = String(body.status || '').toLowerCase();
    if (!['completed', 'passed', 'failed', 'incomplete', 'browsed'].includes(status))
      return send(res, 400, { error: 'status must be one of: completed, passed, failed, incomplete, browsed.' });
    const key = `${req.auth.id}:${course.id}`;
    store.courseLessonProgress[key] ||= [];
    if ((status === 'completed' || status === 'passed') && !store.courseLessonProgress[key].includes(lessonId)) {
      store.courseLessonProgress[key].push(lessonId);
      awardXp(req.auth.id, 10, 'lesson-complete');
      awardBadge(req.auth.id, 'first-steps');
      const lesson = courseAllLessons(course).find(l => l.id === lessonId);
      standards.emitXapi({ institutionId: course.institutionId || req.auth.institutionId, user: req.auth, verbKey: status === 'passed' ? 'passed' : 'completed', objectId: `eduverse:lesson:${lessonId}`, objectName: lesson ? lesson.title : lessonId, result: { completion: true, success: status !== 'failed' } });
    }
    await persist();
    return send(res, 200, { committed: status });
  }

  // xAPI statements.
  if (req.method === 'POST' && url.pathname === '/api/xapi/statements') {
    const body = await readBody(req).catch(() => null);
    const v = standards.validateXapiStatement(body);
    if (!v.ok) return send(res, 400, { error: v.error });
    const st = standards.recordXapiStatement({ institutionId: req.auth.institutionId || null, ...v.value, source: 'api' });
    await persist();
    return send(res, 201, { stored: true, id: st.id });
  }
  if (req.method === 'GET' && url.pathname === '/api/admin/xapi/statements') {
    if (!stdNeedPerm('standards.manage')) return;
    const qVerb = String(url.searchParams.get('verb') || '').toLowerCase();
    const qSince = String(url.searchParams.get('since') || '');
    const list = (store.xapiStatements || []).filter(s =>
      stdInScope(s) &&
      (!qVerb || String(s.verb && s.verb.id || '').toLowerCase().includes(qVerb)) &&
      (!qSince || String(s.stored || '') >= qSince));
    return send(res, 200, { statements: list.slice(0, 200), count: list.length });
  }

  // Enrollment report exports: printable HTML (print-to-PDF) and SpreadsheetML (.xls).
  const enrollmentExportRows = () => {
    const s = org.orgScope(req.auth);
    const qCourse = url.searchParams.get('courseId'), qSem = url.searchParams.get('semesterId'), qInst = url.searchParams.get('institutionId');
    if (qInst && !stdInScope({ institutionId: qInst })) return null;
    return standards.enrollmentReportRows({ courseId: qCourse || undefined, semesterId: qSem || undefined, institutionId: qInst || s.institutionId || undefined });
  };
  if (req.method === 'GET' && url.pathname === '/api/admin/reports/enrollments.pdf') {
    if (!org.can(req.auth, 'reports.view')) return send(res, 403, { error: 'Not permitted for your role.' });
    const rows = enrollmentExportRows();
    if (!rows) return send(res, 403, { error: 'Not permitted for this institution.' });
    const s = org.orgScope(req.auth);
    const inst = s.institutionId ? (store.institutions || []).find(i => i.id === s.institutionId) : null;
    const html = standards.enrollmentReportHtml(rows, { generatedAt: new Date().toISOString(), institutionName: inst ? inst.name : '' });
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Content-Disposition': 'attachment; filename="enrollments.html"', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
    return res.end(html);
  }
  if (req.method === 'GET' && url.pathname === '/api/admin/reports/enrollments.xls') {
    if (!org.can(req.auth, 'reports.view')) return send(res, 403, { error: 'Not permitted for your role.' });
    const rows = enrollmentExportRows();
    if (!rows) return send(res, 403, { error: 'Not permitted for this institution.' });
    const xls = standards.enrollmentReportXls(rows);
    res.writeHead(200, { 'Content-Type': 'application/vnd.ms-excel', 'Content-Disposition': 'attachment; filename="enrollments.xls"', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
    return res.end(xls);
  }
  if (req.method === 'GET' && url.pathname === '/api/teacher/reading-lists') {
    const courseId = String(url.searchParams.get('courseId') || '');
    const list = (store.readingLists || []).filter(rl =>
      rl.teacherId === req.auth.id && (!courseId || rl.courseId === courseId)
    ).sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')));
    return send(res, 200, { readingLists: list.map(populateReadingList) });
  }
  if (req.method === 'POST' && url.pathname === '/api/teacher/reading-lists') return readBody(req).then(async body => {
    const title = String(body.title || '').trim();
    if (title.length < 2 || title.length > 200) return send(res, 400, { error: 'Title must be 2 to 200 characters.' });
    const courseId = body.courseId ? String(body.courseId) : null;
    if (courseId) {
      const course = (store.courses || []).find(c => c.id === courseId);
      if (!course) return send(res, 404, { error: 'Course not found.' });
      if (course.ownerId !== req.auth.id && !org.isAdminRole(req.auth.role))
        return send(res, 403, { error: 'You can only attach reading lists to your own courses.' });
    }
    const itemIds = Array.isArray(body.itemIds) ? [...new Set(body.itemIds.map(String))].slice(0, 100) : [];
    const sc = org.orgScope(req.auth);
    for (const iid of itemIds) {
      const it = (store.libraryItems || []).find(i => i.id === iid);
      if (!it) return send(res, 400, { error: 'One of the selected items does not exist.' });
      if (sc.institutionId && it.institutionId && it.institutionId !== sc.institutionId)
        return send(res, 400, { error: 'One of the selected items belongs to another institution.' });
    }
    const rl = { id: randomUUID(), institutionId: sc.institutionId || (store.institutions[0] || {}).id || null, courseId, teacherId: req.auth.id, title, itemIds, createdAt: new Date().toISOString() };
    store.readingLists.unshift(rl);
    await persist(); send(res, 201, { readingList: populateReadingList(rl) });
  }).catch(e => send(res, 400, { error: e.message }));
  if (req.method === 'DELETE' && /^\/api\/teacher\/reading-lists\/[^/]+$/.test(url.pathname)) return readBody(req).then(async () => {
    const id = url.pathname.split('/').pop();
    const rl = (store.readingLists || []).find(r => r.id === id);
    if (!rl) return send(res, 404, { error: 'Reading list not found.' });
    if (rl.teacherId !== req.auth.id && !org.isAdminRole(req.auth.role))
      return send(res, 403, { error: 'You can only delete your own reading lists.' });
    store.readingLists = (store.readingLists || []).filter(r => r.id !== id);
    await persist(); send(res, 200, { deleted: true });
  }).catch(e => send(res, 400, { error: e.message }));
  if (req.method === 'POST' && url.pathname.startsWith('/api/teacher/')) return readBody(req).then(async body=>{const kind=url.pathname.split('/')[3];if(!['schedule','attendance','practice','tests'].includes(kind))return send(res,404,{error:'Teacher tool not found'});const teacherData=teacherWorkspaceFor(req.auth.id),classItem=(store.classes||[]).find(c=>c.id===body.classId&&c.teacherIds.includes(req.auth.id));if(body.classId&&!classItem)return send(res,403,{error:'That class is not assigned to this teacher.'});if(kind==='attendance'){if(!classItem)return send(res,400,{error:'Choose one of your assigned classes.'});const allowed=new Set((classItem.studentIds||[]).filter(id=>store.users.some(u=>u.id===id&&u.role==='student'&&u.status==='active'))),rows=body.attendance;if(!/^\d{4}-\d{2}-\d{2}$/.test(String(body.date||''))||Number.isNaN(Date.parse(`${body.date}T00:00:00Z`))||new Date(`${body.date}T00:00:00Z`).toISOString().slice(0,10)!==body.date)return send(res,400,{error:'Choose a valid attendance date.'});if(!allowed.size)return send(res,400,{error:'This class has no active students to mark.'});if(!Array.isArray(rows)||rows.length!==allowed.size||new Set(rows.map(a=>a.studentId)).size!==allowed.size||rows.some(a=>!allowed.has(a.studentId)||!['present','absent','late'].includes(a.status)))return send(res,400,{error:'Mark every active student exactly once as present, absent, or late.'});const existing=teacherData.attendance.find(a=>a.classId===classItem.id&&a.date===body.date);if(existing){existing.attendance=rows;existing.updatedAt=new Date().toISOString();existing.className=classItem.name;await persist();return send(res,200,{item:existing,teacherData});}const item={id:randomUUID(),classId:classItem.id,className:classItem.name,date:body.date,attendance:rows,ownerId:req.auth.id,createdAt:new Date().toISOString()};teacherData.attendance.unshift(item);await persist();return send(res,201,{item,teacherData});}if(['practice','tests'].includes(kind)&&!classItem)return send(res,400,{error:'Choose a class so this activity has an authorized audience.'});const item={id:randomUUID(),...body,ownerId:req.auth.id,createdAt:new Date().toISOString()};teacherData[kind].unshift(item);if(kind==='tests'&&classItem)item.studentIds=classItem.studentIds;if(kind==='practice'&&classItem)item.studentIds=classItem.studentIds;if(classItem){const title=kind==='schedule'?'New class session':kind==='tests'?'New class test':'New practice activity',message=kind==='schedule'?`${item.title||'Class'} · ${item.date||''} ${item.time||''}`.trim():`${item.title||item.topic||'New learning activity'} · ${classItem.name}`;notifyClassStudents(classItem,kind==='schedule'?'live-class-reminder':kind==='tests'?'new-class-test':'new-practice',title,message,item.id);}await persist();send(res,201,{item,teacherData});}).catch(e=>send(res,400,{error:e.message}));
  if (req.method === 'POST' && url.pathname === '/api/feedback') return readBody(req).then(async body=>{if(typeof body.message!=='string'||!body.message.trim())return send(res,400,{error:'Feedback message is required.'});if(!store.feedback)store.feedback=[];const item={id:randomUUID(),category:String(body.category||'general').slice(0,50),subject:String(body.subject||'').trim().slice(0,120),message:body.message.trim().slice(0,3000),createdAt:new Date().toISOString()};store.feedback.unshift(item);await persist();send(res,201,{feedback:item});}).catch(e=>send(res,400,{error:e.message}));
  if (req.method === 'GET' && url.pathname === '/api/notes') return send(res,200,{notes:(store.notes||[]).filter(n=>n.ownerId===req.auth.id)});
  if (req.method === 'POST' && url.pathname === '/api/notes') return readBody(req).then(async body=>{
    if(typeof body.title!=='string'||!body.title.trim()||body.title.length>100||typeof body.content!=='string'||body.content.length>12000)return send(res,400,{error:'Provide a title and note content (up to 12,000 characters).'});
    if(!store.notes)store.notes=[];const note={id:randomUUID(),ownerId:req.auth.id,title:body.title.trim(),content:body.content,updatedAt:new Date().toISOString()};
    if(body.courseId!==undefined)note.courseId=String(body.courseId).slice(0,100)||null;
    if(body.lessonId!==undefined)note.lessonId=String(body.lessonId).slice(0,100)||null;
    if(body.videoTimestampSec!==undefined){const t=Math.floor(Number(body.videoTimestampSec));if(!Number.isInteger(t)||t<0||t>86400)return send(res,400,{error:'Video timestamp must be 0 to 86,400 seconds.'});note.videoTimestampSec=t;}
    store.notes.unshift(note);await persist();send(res,201,{note});
  }).catch(e=>send(res,400,{error:e.message}));
  if (req.method === 'DELETE' && /^\/api\/notes\/[^/]+$/.test(url.pathname)) {
    const id = decodeURIComponent(url.pathname.split('/').pop());
    const note = (store.notes || []).find(n => n.id === id && n.ownerId === req.auth.id);
    if (!note) return send(res, 404, { error: 'Note not found.' });
    store.notes = (store.notes || []).filter(n => n !== note);
    await persist();
    return send(res, 200, { deleted: true });
  }
  if (req.method === 'PATCH' && /^\/api\/notes\/[^/]+$/.test(url.pathname)) return readBody(req).then(async body=>{
    if(typeof body.title!=='string'||!body.title.trim()||body.title.length>100||typeof body.content!=='string'||body.content.length>12000)return send(res,400,{error:'Provide a title and note content (up to 12,000 characters).'});
    const id=decodeURIComponent(url.pathname.split('/').pop()),note=(store.notes||[]).find(n=>n.id===id&&n.ownerId===req.auth.id);
    if(!note)return send(res,404,{error:'Note not found.'});
    note.title=body.title.trim();note.content=body.content;note.updatedAt=new Date().toISOString();await persist();send(res,200,{note});
  }).catch(e=>send(res,400,{error:e.message}));
  if (req.method === 'GET' && url.pathname === '/api/assignments') {const assignments=(store.assignments||[]).filter(a=>req.auth.role==='admin'||(req.auth.role==='teacher'?(a.teacherId===req.auth.id||(store.classes||[]).some(c=>c.id===a.classId&&c.teacherIds.includes(req.auth.id))):Array.isArray(a.studentIds)&&a.studentIds.includes(req.auth.id))).map(a=>{if(req.auth.role==='teacher'||req.auth.role==='admin')return {...a,submissions:Object.entries(a.submissions||{}).map(([studentId,s])=>({studentId,...s}))};const mine=a.submissions?.[req.auth.id],grade=mine?.grade?.releasedAt?mine.grade:null;return {id:a.id,title:a.title,course:a.course,description:a.description,dueDate:a.dueDate,allowLate:!!a.allowLate,status:mine?'submitted':'assigned',submission:mine?.text||'',fileUrl:mine?.fileUrl||'',fileName:mine?.fileName||'',late:!!mine?.late,feedback:grade?.feedback||'',questions:Array.isArray(a.questions)?a.questions:[],grade:grade?{marks:grade.marks,maxMarks:grade.maxMarks}:null};});return send(res,200,{assignments});}
  if (req.method === 'POST' && url.pathname === '/api/assignments') return readBody(req).then(async body=>{
    if(req.auth.role==='teacher'&&!hasPerm('teacher','canCreateAssignments'))return send(res,403,{error:'Assignment creation is disabled for teachers by the administrator.'});
    if(typeof body.title!=='string'||!body.title.trim()||body.title.length>120||typeof body.description!=='string'||!body.description.trim())return send(res,400,{error:'Assignment title and instructions are required.'});
    const klass=(store.classes||[]).find(c=>c.id===body.classId&&(req.auth.role==='admin'||c.teacherIds.includes(req.auth.id)));if(!klass)return send(res,400,{error:'Choose a class assigned to you before publishing this assignment.'});
    if(!klass.studentIds.length)return send(res,400,{error:'Enroll at least one student in this class before publishing.'});
    const questions=Array.isArray(body.questions)?body.questions:typeof body.questions==='string'?body.questions.split(/\r?\n/):[];const cleanedQuestions=questions.map(q=>String(q).trim()).filter(Boolean);if(cleanedQuestions.length>50||cleanedQuestions.some(q=>q.length>1000)||cleanedQuestions.reduce((n,q)=>n+q.length,0)>10000)return send(res,400,{error:'Add up to 50 questions or tasks (10,000 characters total).'});if(!store.assignments)store.assignments=[];const arc=validateExamRubric(body.rubric);if(!arc.ok)return send(res,400,{error:arc.error});const item={id:randomUUID(),classId:klass.id,teacherId:req.auth.id,studentIds:[...klass.studentIds],title:body.title.trim(),course:String(body.course||klass.subject||'General').slice(0,100),description:body.description.trim().slice(0,2000),questions:cleanedQuestions,rubric:arc.value,dueDate:String(body.dueDate||'').slice(0,20),allowLate:body.allowLate===true,status:'assigned',submission:'',feedback:''};store.assignments.unshift(item);notifyClassStudents(klass,'new-assignment','New class assignment',`${item.title}${item.dueDate?` · Due ${item.dueDate}`:''}`,item.id);await persist();send(res,201,{assignment:item});
  }).catch(e=>send(res,400,{error:e.message}));
  if (req.method === 'PATCH' && /^\/api\/assignments\/[^/]+$/.test(url.pathname)) return readBody(req).then(async body=>{
    const id=url.pathname.split('/')[3];
    const item=(store.assignments||[]).find(a=>a.id===id);
    if(!item)return send(res,404,{error:'Assignment not found'});
    if(!(req.auth.role==='admin'||(req.auth.role==='teacher'&&(item.teacherId===req.auth.id||(store.classes||[]).some(c=>c.id===item.classId&&c.teacherIds.includes(req.auth.id))))))return send(res,403,{error:'Only the assigned class teacher or an administrator can update it.'});
    if(body.allowLate!==undefined)item.allowLate=body.allowLate===true;
    if(body.dueDate!==undefined)item.dueDate=String(body.dueDate||'').slice(0,20);
    if(body.title!==undefined){if(typeof body.title!=='string'||!body.title.trim()||body.title.length>120)return send(res,400,{error:'Assignment title is required.'});item.title=body.title.trim();}
    if(body.description!==undefined){if(typeof body.description!=='string'||!body.description.trim())return send(res,400,{error:'Assignment instructions are required.'});item.description=body.description.trim().slice(0,2000);}
    await persist();send(res,200,{assignment:item});
  }).catch(e=>send(res,400,{error:e.message}));
  if (req.method === 'POST' && url.pathname.startsWith('/api/assignments/') && url.pathname.endsWith('/submit')) return readBody(req).then(async body=>{
    const id=url.pathname.split('/')[3];
    const result=await executeIdempotent({actorId:req.auth.id,scope:`assignment:${id}:submit`,key:req.headers['idempotency-key'],payload:body},async()=>{
      const item=(store.assignments||[]).find(a=>a.id===id);
      if(!item||!item.studentIds?.includes(req.auth.id))return {status:404,payload:{error:'Assignment not found for this student'}};
      const rawText=typeof body.submission==='string'?body.submission:(typeof body.text==='string'?body.text:'');
      const text=rawText.trim();
      const fileUrl=typeof body.fileUrl==='string'?body.fileUrl.trim().slice(0,500):'';
      const fileName=typeof body.fileName==='string'?body.fileName.trim().slice(0,120):'';
      if(text.length>8000)return {status:400,payload:{error:'Submission text must be up to 8,000 characters.'}};
      if(!text&&!fileUrl)return {status:400,payload:{error:'Add submission text or attach a file.'}};
      if(fileUrl&&!/^(https?:\/\/|\/uploads\/)/.test(fileUrl))return {status:400,payload:{error:'Attach a file uploaded through EduVerse first.'}};
      item.submissions ||= {};
      const existing=item.submissions[req.auth.id];
      if(existing?.grade?.releasedAt)return {status:403,payload:{error:'This submission has already been graded and released; resubmission is closed.'}};
      const dueRaw=String(item.dueDate||'');
      const dueMs=/^\d{4}-\d{2}-\d{2}$/.test(dueRaw)?Date.parse(dueRaw+'T23:59:59.999Z'):Date.parse(dueRaw);
      const late=Number.isFinite(dueMs)&&Date.now()>dueMs;
      if(late&&!item.allowLate)return {status:400,payload:{error:'Submission deadline has passed.'}};
      if(existing?.text===text&&existing?.fileUrl===fileUrl)return {status:200,payload:{assignment:{id:item.id,status:'submitted',submission:existing.text,late:!!existing.late,fileUrl:existing.fileUrl||'',fileName:existing.fileName||''}}};
      const firstAssignmentSubmission=!existing;
      item.submissions[req.auth.id]={text,fileUrl,fileName,late,submittedAt:new Date().toISOString()};
      if(firstAssignmentSubmission)awardXp(req.auth.id,20,'assignment-submit');
      return {status:200,payload:{assignment:{id:item.id,status:'submitted',submission:text,late,fileUrl,fileName}},changed:true};
    });
    return send(res,result.status,result.payload);
  }).catch(e=>send(res,400,{error:e.message}));
  if (req.method === 'GET' && url.pathname === '/api/syllabus') return send(res,200,{tracks:[{id:'web',title:'Web development',modules:['HTML & semantic structure','CSS layouts and responsive design','JavaScript fundamentals','DOM, events, and browser APIs','React components and state','APIs, Git, and deployment']},{id:'dsa',title:'Data structures & algorithms',modules:['Complexity and Big O','Arrays, strings, and hash maps','Stacks, queues, and linked lists','Recursion and trees','Sorting and binary search','Graphs and dynamic programming']},{id:'backend',title:'Backend engineering',modules:['HTTP and REST fundamentals','Node.js and Express','Data modeling and databases','Authentication and authorization','Validation, errors, and security','Testing and deployment']} ]});
  if (req.method === 'POST' && url.pathname === '/api/attempts') return readBody(req).then(async body=>{
    if(body.activityId!=='binary-search-boundary'||!['left','right'].includes(body.answer))return send(res,400,{error:'Provide a valid binary-search activity and answer.'});
    const correct=body.answer==='right',progress=progressForUser(req.auth.id);
    const previous=progress.concepts['search-boundaries'];
    const attempt={id:randomUUID(),studentId:req.auth.id,activityId:body.activityId,answer:body.answer,correct,createdAt:new Date().toISOString()};
    store.userAttempts ||= {};store.userAttempts[req.auth.id] ||= [];store.userAttempts[req.auth.id].push(attempt);
    previous.evidenceCount+=1;
    // Small, bounded illustrative mastery update based on a validated attempt.
    previous.mastery=Math.min(100,Math.max(0,Math.round(previous.mastery+(correct?5:-2))));
    if(correct)progress.completedChallenges+=1;
    await persist();send(res,201,{attempt,progress});
  }).catch(e=>send(res,400,{error:e.message}));

  // ---- Public platform settings (non-secret subset) ----
  if (req.method === 'GET' && url.pathname === '/api/settings') return send(res,200,{settings:publicSettings()});
  // ---- Auth: change password, forgot / reset (admin-issued recovery) ----
  if (req.method === 'POST' && url.pathname === '/api/auth/change-password') return readBody(req).then(async body=>{
    if(!consumeRate(changePasswordAttempts, req.auth.id, 10, 60*60*1000))return send(res,429,{error:'Too many password changes. Try again later.'});
    const user=store.users.find(u=>u.id===req.auth.id); if(!user) return send(res,401,{error:'Sign in required'});
    if(!await passwordMatches(String(body.currentPassword||''),user.passwordHash)) return send(res,401,{error:'Current password was not recognized.'});
    if(String(body.newPassword||'').length<12) return send(res,400,{error:'Use a new password of at least 12 characters.'});
    user.passwordHash=await passwordHash(String(body.newPassword)); removeSessionsForUser(user.id); jwt.revokeAllForUser(user.id); await persist(); audit(req.auth,'changed password',user.email); send(res,200,{ok:true});
  }).catch(e=>send(res,400,{error:e.message}));
  if (req.method === 'POST' && url.pathname === '/api/auth/forgot-password') return readBody(req).then(async body=>{
    if(!consumeRate(forgotAttempts, req.socket.remoteAddress||'local', 3, 60*60*1000))return send(res,429,{error:'Too many recovery requests. Try again later.'});
    const emailAddr=String(body.email||'').trim().toLowerCase(); const user=store.users.find(u=>u.email===emailAddr);
    store.resetTokens=(store.resetTokens||[]).filter(t=>t.expiresAt>Date.now());
    if(user&&!consumeRate(forgotAttempts, `email:${emailAddr}`, 3, 60*60*1000))return send(res,429,{error:'Too many recovery requests. Try again later.'});
    if(user){ const token=randomBytes(32).toString('hex'); store.resetTokens.push({id:randomUUID(),userId:user.id,tokenHash:await passwordHash(token),expiresAt:Date.now()+15*60*1000,createdAt:new Date().toISOString(),issuedBy:'self-request'}); await persist();
      // Send the recovery link by email when a provider is configured; else keep dev-outbox behavior.
      if (email.provider() !== 'outbox') {
        const link = `${process.env.APP_BASE_URL || 'http://127.0.0.1:4173'}/#reset?token=${token}`;
        email.sendEmail({ to: user.email, subject: 'EduVerse password reset', html: `<p>Reset your password within 15 minutes:</p><p><a href="${link}">${link}</a></p>` }).catch(e => monitor.captureError(e, { kind: 'reset-email' }));
      } else {
        email.sendEmail({ to: user.email, subject: 'EduVerse password reset (dev outbox)', html: `<p>Dev outbox — no real email sent. Ask an administrator for a recovery code.</p>` }).catch(() => {});
      }
    }
    send(res,200,{ok:true,message: email.provider()==='outbox' ? 'If that account exists, an administrator can issue a recovery code for it. Email delivery is not configured in this local build.' : 'If that account exists, a password reset link has been emailed.'});
  }).catch(e=>send(res,400,{error:e.message}));
  if (req.method === 'POST' && url.pathname === '/api/auth/reset-password') return readBody(req).then(async body=>{
    if(!consumeRate(resetAttempts, req.socket.remoteAddress||'local', 10, 60*60*1000))return send(res,429,{error:'Too many reset attempts. Try again later.'});
    const token=String(body.token||''); if(String(body.password||'').length<12) return send(res,400,{error:'Use a password of at least 12 characters.'});
    let matched=null; for (const t of (store.resetTokens||[])) { if(t.expiresAt>Date.now() && await passwordMatches(token,t.tokenHash)) { matched=t; break; } }
    if(!matched) return send(res,400,{error:'That recovery code is invalid or expired.'});
    const user=store.users.find(u=>u.id===matched.userId); if(!user) return send(res,404,{error:'Account not found.'});
    user.passwordHash=await passwordHash(String(body.password)); store.resetTokens=store.resetTokens.filter(t=>t.id!==matched.id); removeSessionsForUser(user.id); jwt.revokeAllForUser(user.id); startSession(res,user); const pair=jwt.issueTokenPair(user); await persist(); send(res,200,{ok:true,user:publicUser(user),...pair});
  }).catch(e=>send(res,400,{error:e.message}));
  // ---- MFA (administrators) ----
  if (req.method === 'POST' && url.pathname === '/api/auth/mfa/setup') return send(res,200,{secret:(()=>{ const user=store.users.find(u=>u.id===req.auth.id); if(!user||user.role!=='admin') return null; if(!user.mfaSecret) user.mfaSecret=base32Encode(randomBytes(20)); persist(); return user.mfaSecret; })()||'', mfaEnabled:!!store.users.find(u=>u.id===req.auth.id)?.mfaEnabled});
  if (req.method === 'POST' && url.pathname === '/api/auth/mfa/verify') return readBody(req).then(async body=>{ if(!consumeRate(mfaAttempts, req.auth.id, 10, 10*60*1000))return send(res,429,{error:'Too many MFA attempts. Try again later.'}); const user=store.users.find(u=>u.id===req.auth.id); if(!user||user.role!=='admin'||!user.mfaSecret) return send(res,400,{error:'Generate an authenticator secret first.'}); if(!totpValid(user.mfaSecret,body.code)) return send(res,401,{error:'That authenticator code is not correct.'}); user.mfaEnabled=true; audit(req.auth,'enabled MFA',user.email); await persist(); send(res,200,{ok:true}); }).catch(e=>send(res,400,{error:e.message}));
  if (req.method === 'POST' && url.pathname === '/api/auth/mfa/disable') return readBody(req).then(async body=>{ const user=store.users.find(u=>u.id===req.auth.id); if(!user||user.role!=='admin') return send(res,400,{error:'Administrator access required.'}); if(user.mfaEnabled&&!totpValid(user.mfaSecret,body.code)) return send(res,401,{error:'That authenticator code is not correct.'}); user.mfaEnabled=false; audit(req.auth,'disabled MFA',user.email); await persist(); send(res,200,{ok:true}); }).catch(e=>send(res,400,{error:e.message}));
  // ---- Course enrollment & lesson completion ----
  if (req.method === 'POST' && /^\/api\/courses\/[^/]+\/enroll$/.test(url.pathname)) return readBody(req).then(async body=>{
    const id=url.pathname.split('/')[3];
    const result=await executeIdempotent({actorId:req.auth.id,scope:`course:${id}:enroll`,key:req.headers['idempotency-key'],payload:body},async()=>{
      const course=(store.courses||[]).find(c=>c.id===id);
      if(!course)return {status:404,payload:{error:'Course not found.'}};
      if(course.status==='draft')return {status:403,payload:{error:'This course is still a draft.'}};
      if(req.auth.role!=='student')return {status:403,payload:{error:'Only students enroll in courses.'}};
      if(!hasPerm('student','canEnrollCourses'))return {status:403,payload:{error:'Course enrollment is disabled.'}};
      if(Number(course.priceCents||0)>0&&!hasCourseAccess(req.auth.id,id))return {status:402,payload:{error:'This is a paid course. Complete checkout to enroll.',checkout:{kind:'course',courseId:id}}};
      if((store.enrollments||[]).some(e=>e.studentId===req.auth.id&&e.courseId===id))return {status:200,payload:{enrolled:true}};
      store.enrollments.push({id:randomUUID(),studentId:req.auth.id,courseId:id,enrolledAt:new Date().toISOString()});
      return {status:201,payload:{enrolled:true},changed:true};
    });
    return send(res,result.status,result.payload);
  }).catch(e=>send(res,400,{error:e.message}));
  if (req.method === 'GET' && url.pathname === '/api/my-enrollments') { const mine=(store.enrollments||[]).filter(e=>e.studentId===req.auth.id); return send(res,200,{enrollments:mine.map(e=>({...e,course:(store.courses||[]).find(c=>c.id===e.courseId)||null,completedLessons:(store.courseLessonProgress[`${req.auth.id}:${e.courseId}`]||[]).length}))}); }
  // ---- Vision lab assignments (teacher) ----
  if (req.method === 'GET' && url.pathname === '/api/teacher/vision-assignments') return send(res,200,{assignments:(store.visionAssignments||[]).filter(a=>a.teacherId===req.auth.id)});
  if (req.method === 'GET' && url.pathname === '/api/vision-assignments') { const classIds=new Set((store.classes||[]).filter(c=>c.studentIds.includes(req.auth.id)).map(c=>c.id)); return send(res,200,{assignments:(store.visionAssignments||[]).filter(a=>classIds.has(a.classId))}); }
  if (req.method === 'GET' && url.pathname === '/api/teacher/vision-results') { const classes=(store.classes||[]).filter(c=>c.teacherIds.includes(req.auth.id)),classIds=new Set(classes.map(c=>c.id)),studentIds=new Set(classes.flatMap(c=>c.studentIds||[])); const rows=[]; for (const [uid,vision] of Object.entries(store.userVision||{})) { if(!studentIds.has(uid)) continue; for (const ev of (vision.events||[])) { const a=(store.visionAssignments||[]).find(x=>x.experimentId===ev.experimentId&&classIds.has(x.classId)); if(a) rows.push({studentId:uid,studentName:store.users.find(u=>u.id===uid)?.name||'Student',experimentId:ev.experimentId,score:ev.score,type:ev.type,createdAt:ev.createdAt,className:a.className}); } } return send(res,200,{results:rows.sort((a,b)=>b.createdAt.localeCompare(a.createdAt)).slice(0,200)}); }
  // ---- Admin: create user, teachers/students, org, permissions, settings, courses, enrollments, reports, services, recovery ----
  if (req.method === 'POST' && url.pathname === '/api/admin/users') return readBody(req).then(async body=>{ if(!hasPerm('admin','canManageUsers')) return send(res,403,{error:'User management is disabled.'}); const name=String(body.name||'').trim(),email=String(body.email||'').trim().toLowerCase(),password=String(body.password||''); if(name.length<2||!/^\S+@\S+\.\S+$/.test(email)||password.length<12) return send(res,400,{error:'Enter a name, valid email, and a 12+ character password.'}); const isSuper=org.effectiveRole(req.auth.role)==='super_admin'; const allowedRoles=isSuper?['student','teacher','parent','institution_admin','admin','super_admin']:['student','teacher','parent','institution_admin']; if(!allowedRoles.includes(body.role)) return send(res,403,{error:'Choose a valid role.'}); let username=String(body.username||email.split('@')[0]||'').trim().toLowerCase().replace(/[^a-z0-9._-]/g,'');
    if(username.length<3) username=(username+'user').slice(0,3).padEnd(3,'0');
    username=username.slice(0,30);
    if(!/^[a-z0-9][a-z0-9._-]{2,29}$/.test(username)) return send(res,400,{error:'Provide a valid username (3-30 letters, numbers, dots, underscores, hyphens).'});
    if(store.users.some(u=>(u.username||'').toLowerCase()===username)) return send(res,409,{error:'That username is already in use.'});
    if(store.users.some(u=>u.email===email)) return send(res,409,{error:'Unable to create this account with those details.'});
    // Org assignment: institution_admin is scoped to their own institution.
    const scope=org.orgScope(req.auth);
    let institutionId=scope.institutionId||null;
    if(isSuper){ if(body.institutionId!==undefined){ const inst=(store.institutions||[]).find(i=>i.id===body.institutionId); if(!inst) return send(res,400,{error:'Choose an existing institution.'}); institutionId=inst.id; } if(!institutionId) institutionId=(store.institutions[0]||{}).id||null; }
    let campusId=null,departmentId=null;
    if(body.campusId){ const cp=(store.campuses||[]).find(c=>c.id===body.campusId&&c.institutionId===institutionId); if(!cp) return send(res,400,{error:'Choose a campus in this institution.'}); campusId=cp.id; }
    if(body.departmentId){ const dp=(store.departments||[]).find(d=>d.id===body.departmentId&&d.institutionId===institutionId&&(!campusId||!d.campusId||d.campusId===campusId)); if(!dp) return send(res,400,{error:'Choose a department in this institution.'}); departmentId=dp.id; }
    const user={id:randomUUID(),name,username,email,passwordHash:await passwordHash(password),role:body.role,status:body.role==='teacher'&&store.settings.requireTeacherApproval!==false?'pending':'active',institutionId,campusId,departmentId,createdAt:new Date().toISOString()}; store.users.push(user); audit(req.auth,`created ${body.role}`,email); await persist(); send(res,201,{user:publicUser(user)}); }).catch(e=>send(res,400,{error:e.message}));
  if (req.method === 'POST' && /^\/api\/admin\/users\/[^/]+\/recovery$/.test(url.pathname)) return readBody(req).then(async body=>{ const id=url.pathname.split('/')[4],user=store.users.find(u=>u.id===id); if(!user||org.effectiveRole(user.role)==='super_admin') return send(res,404,{error:'Account not found or protected.'}); const token=randomBytes(24).toString('hex'); store.resetTokens=(store.resetTokens||[]).filter(t=>t.expiresAt>Date.now()); store.resetTokens.push({id:randomUUID(),userId:user.id,tokenHash:await passwordHash(token),expiresAt:Date.now()+15*60*1000,createdAt:new Date().toISOString(),issuedBy:req.auth.id}); audit(req.auth,'issued account recovery',user.email); await persist(); send(res,201,{recoveryToken:token,expiresInMinutes:15}); }).catch(e=>send(res,400,{error:e.message}));
  if (req.method === 'GET' && url.pathname === '/api/admin/teachers') return send(res,200,{users:store.users.filter(u=>u.role==='teacher').map(publicUser),classes:store.classes||[]});
  if (req.method === 'GET' && url.pathname === '/api/admin/students') return send(res,200,{users:store.users.filter(u=>u.role==='student').map(u=>({...publicUser(u),guardianName:u.guardianName||'',guardianPhone:u.guardianPhone||''})),enrollments:store.enrollments||[],classes:store.classes||[]});
  if (req.method === 'GET' && url.pathname === '/api/admin/permissions') return send(res,200,{permissions:store.permissions});
  if (req.method === 'PATCH' && url.pathname === '/api/admin/permissions') return readBody(req).then(async body=>{ const perms=body.permissions||{}; for (const [role, set] of Object.entries(perms)) { if(!['teacher','student'].includes(role)) continue; store.permissions[role] ||= {}; for (const [k,v] of Object.entries(set)) { if(typeof v==='boolean') store.permissions[role][k]=v; } } audit(req.auth,'updated role permissions','teacher/student'); await persist(); send(res,200,{permissions:store.permissions}); }).catch(e=>send(res,400,{error:e.message}));
  if (req.method === 'GET' && url.pathname === '/api/admin/org') return send(res,200,{institutions:store.institutions||[],departments:store.departments||[],terms:store.terms||[]});
  if (req.method === 'POST' && url.pathname === '/api/admin/org') return readBody(req).then(async body=>{ const kind=body.kind, name=String(body.name||'').trim(); if(!['institution','department','term'].includes(kind)||name.length<2||name.length>120) return send(res,400,{error:'Provide a valid type and name (2 to 120 characters).'}); if(kind==='department'&&body.institutionId&&!store.institutions.some(i=>i.id===body.institutionId)) return send(res,400,{error:'Choose an existing institution.'}); const coll=kind==='institution'?'institutions':kind==='department'?'departments':'terms'; const item={id:randomUUID(),name,institutionId:body.institutionId||null,detail:String(body.detail||'').slice(0,200),createdAt:new Date().toISOString()}; if(kind==='institution') org.normalizeInstitution(item); store[coll].unshift(item); audit(req.auth,`created ${kind}`,name); await persist(); send(res,201,{item}); }).catch(e=>send(res,400,{error:e.message}));
  // ---- Institution-ready core (Slice A): institutions, campuses, departments, academic calendar, roles ----
  const orgCanRead = org.can(req.auth, 'org.manage') || org.can(req.auth, 'org.view');
  const needOrgManage = () => { if (!org.can(req.auth, 'org.manage')) { send(res, 403, { error: 'Organization management is not permitted for your role.' }); return false; } return true; };
  const scopeInst = (institutionId) => { const s = org.orgScope(req.auth); if (s.institutionId && s.institutionId !== institutionId) { send(res, 403, { error: 'This belongs to another institution.' }); return false; } return true; };
  if (req.method === 'GET' && url.pathname === '/api/institution/branding') {
    const cacheKey = 'branding:' + (org.pickBrandingInstitution()?.id || 'default');
    const cached = await cache.get(cacheKey);
    if (cached) return send(res, 200, cached);
    const inst = org.pickBrandingInstitution();
    const out = !inst ? { name: 'EduVerse 3D', logoUrl: '', primaryColor: '#6d28d9', faviconUrl: '' }
      : { name: inst.name, logoUrl: (inst.branding || {}).logoUrl || '', primaryColor: (inst.branding || {}).primaryColor || '#6d28d9', faviconUrl: (inst.branding || {}).faviconUrl || '' };
    await cache.set(cacheKey, out, 60);
    return send(res, 200, out);
  }
  if (url.pathname === '/api/admin/institutions') {
    if (req.method === 'GET') {
      if (!orgCanRead) return send(res, 403, { error: 'Organization access is not permitted for your role.' });
      const s = org.orgScope(req.auth);
      const list = (store.institutions || []).filter(i => !s.institutionId || i.id === s.institutionId);
      return send(res, 200, { institutions: list });
    }
    if (req.method === 'POST') return readBody(req).then(async body => {
      if (!needOrgManage()) return;
      if (org.orgScope(req.auth).institutionId) return send(res, 403, { error: 'Only a super administrator can create institutions.' });
      const name = org.validName(body.name); if (!name) return send(res, 400, { error: 'Institution name must be 2 to 120 characters.' });
      const rawSlug = String(body.slug || org.slugify(name) || '').trim();
      if (!org.SLUG_RE.test(rawSlug)) return send(res, 400, { error: 'Slug must be 2 to 40 lowercase letters, numbers, or hyphens.' });
      const slug = org.uniqueSlug(rawSlug, null);
      const branding = body.branding !== undefined ? org.normalizeBranding(body.branding) : { logoUrl: '', primaryColor: '#6d28d9', faviconUrl: '' };
      if (!branding) return send(res, 400, { error: 'Branding URLs must be https or relative paths, color must be #rrggbb.' });
      const item = { id: randomUUID(), name, slug, status: 'active', branding, createdAt: new Date().toISOString() };
      store.institutions.unshift(item); audit(req.auth, 'created institution', name); await persist();
      send(res, 201, { institution: item });
    }).catch(e => send(res, 400, { error: e.message }));
  }
  if (req.method === 'PATCH' && /^\/api\/admin\/institutions\/[^/]+$/.test(url.pathname)) return readBody(req).then(async body => {
    if (!needOrgManage()) return;
    const inst = (store.institutions || []).find(i => i.id === url.pathname.split('/')[4]);
    if (!inst) return send(res, 404, { error: 'Institution not found.' });
    if (!scopeInst(inst.id)) return;
    if (body.name !== undefined) { const name = org.validName(body.name); if (!name) return send(res, 400, { error: 'Institution name must be 2 to 120 characters.' }); inst.name = name; }
    if (body.slug !== undefined) { const slug = String(body.slug || '').trim(); if (!org.SLUG_RE.test(slug)) return send(res, 400, { error: 'Slug must be 2 to 40 lowercase letters, numbers, or hyphens.' }); inst.slug = org.uniqueSlug(slug, inst.id); }
    if (body.status !== undefined) { if (!['active', 'suspended'].includes(body.status)) return send(res, 400, { error: 'Status must be active or suspended.' }); inst.status = body.status; }
    if (body.branding !== undefined) { if (!org.can(req.auth, 'branding.manage')) return send(res, 403, { error: 'Branding management is not permitted for your role.' }); const branding = org.normalizeBranding({ ...(inst.branding || {}), ...(body.branding || {}) }); if (!branding) return send(res, 400, { error: 'Branding URLs must be https or relative paths, color must be #rrggbb.' }); inst.branding = branding; await cache.del('branding:' + inst.id); }
    audit(req.auth, 'updated institution', inst.name); await persist(); send(res, 200, { institution: inst });
  }).catch(e => send(res, 400, { error: e.message }));
  if (req.method === 'DELETE' && /^\/api\/admin\/institutions\/[^/]+$/.test(url.pathname)) {
    if (!needOrgManage()) return;
    const id = url.pathname.split('/')[4];
    const inst = (store.institutions || []).find(i => i.id === id);
    if (!inst) return send(res, 404, { error: 'Institution not found.' });
    if (!scopeInst(inst.id)) return;
    const hasRefs = (store.users || []).some(u => u.institutionId === id) || (store.courses || []).some(c => c.institutionId === id) ||
      (store.campuses || []).some(c => c.institutionId === id) || (store.departments || []).some(d => d.institutionId === id) ||
      (store.academicYears || []).some(y => y.institutionId === id);
    if (hasRefs) { inst.status = 'suspended'; audit(req.auth, 'suspended institution', inst.name); return persist().then(() => send(res, 200, { suspended: true, institution: inst })); }
    store.institutions = store.institutions.filter(i => i.id !== id);
    audit(req.auth, 'deleted institution', inst.name); return persist().then(() => send(res, 200, { deleted: true }));
  }
  if (/^\/api\/admin\/institutions\/[^/]+\/campuses$/.test(url.pathname)) {
    const instId = url.pathname.split('/')[4];
    const inst = (store.institutions || []).find(i => i.id === instId);
    if (!inst) return send(res, 404, { error: 'Institution not found.' });
    if (!scopeInst(instId)) return;
    if (req.method === 'GET') {
      if (!orgCanRead) return send(res, 403, { error: 'Organization access is not permitted for your role.' });
      return send(res, 200, { campuses: (store.campuses || []).filter(c => c.institutionId === instId) });
    }
    if (req.method === 'POST') return readBody(req).then(async body => {
      if (!needOrgManage()) return;
      const name = org.validName(body.name); if (!name) return send(res, 400, { error: 'Campus name must be 2 to 120 characters.' });
      const item = { id: randomUUID(), institutionId: instId, name, city: String(body.city || '').slice(0, 120), address: String(body.address || '').slice(0, 500), createdAt: new Date().toISOString() };
      store.campuses.unshift(item); audit(req.auth, 'created campus', name); await persist(); send(res, 201, { campus: item });
    }).catch(e => send(res, 400, { error: e.message }));
  }
  if (req.method === 'PATCH' && /^\/api\/admin\/institutions\/[^/]+\/campuses\/[^/]+$/.test(url.pathname)) return readBody(req).then(async body => {
    if (!needOrgManage()) return;
    const parts = url.pathname.split('/'), instId = parts[4], cid = parts[6];
    const cp = (store.campuses || []).find(c => c.id === cid && c.institutionId === instId);
    if (!cp) return send(res, 404, { error: 'Campus not found.' });
    if (!scopeInst(instId)) return;
    if (body.name !== undefined) { const name = org.validName(body.name); if (!name) return send(res, 400, { error: 'Campus name must be 2 to 120 characters.' }); cp.name = name; }
    if (body.city !== undefined) cp.city = String(body.city).slice(0, 120);
    if (body.address !== undefined) cp.address = String(body.address).slice(0, 500);
    audit(req.auth, 'updated campus', cp.name); await persist(); send(res, 200, { campus: cp });
  }).catch(e => send(res, 400, { error: e.message }));
  if (req.method === 'DELETE' && /^\/api\/admin\/institutions\/[^/]+\/campuses\/[^/]+$/.test(url.pathname)) {
    if (!needOrgManage()) return;
    const parts = url.pathname.split('/'), instId = parts[4], cid = parts[6];
    const cp = (store.campuses || []).find(c => c.id === cid && c.institutionId === instId);
    if (!cp) return send(res, 404, { error: 'Campus not found.' });
    if (!scopeInst(instId)) return;
    const refs = (store.departments || []).some(d => d.campusId === cid) || (store.users || []).some(u => u.campusId === cid) || (store.courses || []).some(c => c.campusId === cid);
    if (refs) return send(res, 409, { error: 'Campus is in use by departments, users, or courses.' });
    store.campuses = store.campuses.filter(c => c.id !== cid);
    audit(req.auth, 'deleted campus', cp.name); return persist().then(() => send(res, 200, { deleted: true }));
  }
  if (url.pathname === '/api/admin/departments') {
    if (req.method === 'GET') {
      if (!orgCanRead) return send(res, 403, { error: 'Organization access is not permitted for your role.' });
      const s = org.orgScope(req.auth);
      const qInst = url.searchParams.get('institutionId') || '';
      if (qInst) { const qi = (store.institutions || []).find(i => i.id === qInst); if (!qi) return send(res, 404, { error: 'Institution not found.' }); if (!scopeInst(qInst)) return; }
      const list = (store.departments || []).filter(d => (!s.institutionId || d.institutionId === s.institutionId) && (!qInst || d.institutionId === qInst));
      return send(res, 200, { departments: list });
    }
    if (req.method === 'POST') return readBody(req).then(async body => {
      if (!needOrgManage()) return;
      const s = org.orgScope(req.auth);
      const institutionId = s.institutionId || body.institutionId;
      const inst = (store.institutions || []).find(i => i.id === institutionId);
      if (!inst) return send(res, 400, { error: 'Choose an existing institution.' });
      if (!scopeInst(inst.id)) return;
      const name = org.validName(body.name); if (!name) return send(res, 400, { error: 'Department name must be 2 to 120 characters.' });
      let campusId = null;
      if (body.campusId) { const cp = (store.campuses || []).find(c => c.id === body.campusId && c.institutionId === inst.id); if (!cp) return send(res, 400, { error: 'Choose a campus in this institution.' }); campusId = cp.id; }
      let headUserId = null;
      if (body.headUserId) { const hu = (store.users || []).find(u => u.id === body.headUserId && u.institutionId === inst.id && u.status === 'active'); if (!hu) return send(res, 400, { error: 'Choose an active user in this institution.' }); headUserId = hu.id; }
      const item = { id: randomUUID(), institutionId: inst.id, campusId, name, headUserId, createdAt: new Date().toISOString() };
      store.departments.unshift(item); audit(req.auth, 'created department', name); await persist(); send(res, 201, { department: item });
    }).catch(e => send(res, 400, { error: e.message }));
  }
  if (req.method === 'PATCH' && /^\/api\/admin\/departments\/[^/]+$/.test(url.pathname)) return readBody(req).then(async body => {
    if (!needOrgManage()) return;
    const dp = (store.departments || []).find(d => d.id === url.pathname.split('/')[4]);
    if (!dp) return send(res, 404, { error: 'Department not found.' });
    if (!scopeInst(dp.institutionId)) return;
    if (body.name !== undefined) { const name = org.validName(body.name); if (!name) return send(res, 400, { error: 'Department name must be 2 to 120 characters.' }); dp.name = name; }
    if (body.campusId !== undefined) { if (!body.campusId) dp.campusId = null; else { const cp = (store.campuses || []).find(c => c.id === body.campusId && c.institutionId === dp.institutionId); if (!cp) return send(res, 400, { error: 'Choose a campus in this institution.' }); dp.campusId = cp.id; } }
    if (body.headUserId !== undefined) { if (!body.headUserId) dp.headUserId = null; else { const hu = (store.users || []).find(u => u.id === body.headUserId && u.institutionId === dp.institutionId && u.status === 'active'); if (!hu) return send(res, 400, { error: 'Choose an active user in this institution.' }); dp.headUserId = hu.id; } }
    audit(req.auth, 'updated department', dp.name); await persist(); send(res, 200, { department: dp });
  }).catch(e => send(res, 400, { error: e.message }));
  if (req.method === 'DELETE' && /^\/api\/admin\/departments\/[^/]+$/.test(url.pathname)) {
    if (!needOrgManage()) return;
    const dp = (store.departments || []).find(d => d.id === url.pathname.split('/')[4]);
    if (!dp) return send(res, 404, { error: 'Department not found.' });
    if (!scopeInst(dp.institutionId)) return;
    const refs = (store.users || []).some(u => u.departmentId === dp.id) || (store.courses || []).some(c => c.departmentId === dp.id);
    if (refs) return send(res, 409, { error: 'Department is in use by users or courses.' });
    store.departments = store.departments.filter(d => d.id !== dp.id);
    audit(req.auth, 'deleted department', dp.name); return persist().then(() => send(res, 200, { deleted: true }));
  }
  if (url.pathname === '/api/admin/academic-years') {
    if (req.method === 'GET') {
      if (!orgCanRead) return send(res, 403, { error: 'Organization access is not permitted for your role.' });
      const s = org.orgScope(req.auth);
      const qInst = url.searchParams.get('institutionId') || '';
      if (qInst) { const qi = (store.institutions || []).find(i => i.id === qInst); if (!qi) return send(res, 404, { error: 'Institution not found.' }); if (!scopeInst(qInst)) return; }
      const list = (store.academicYears || []).filter(y => (!s.institutionId || y.institutionId === s.institutionId) && (!qInst || y.institutionId === qInst));
      return send(res, 200, { academicYears: list });
    }
    if (req.method === 'POST') return readBody(req).then(async body => {
      if (!needOrgManage()) return;
      const s = org.orgScope(req.auth);
      const institutionId = s.institutionId || body.institutionId;
      const inst = (store.institutions || []).find(i => i.id === institutionId);
      if (!inst) return send(res, 400, { error: 'Choose an existing institution.' });
      if (!scopeInst(inst.id)) return;
      const name = org.validName(body.name); if (!name) return send(res, 400, { error: 'Academic year name must be 2 to 120 characters.' });
      const range = org.validDateRange(body.startsAt, body.endsAt);
      if (!range) return send(res, 400, { error: 'Provide valid start and end dates with the end after the start.' });
      const item = { id: randomUUID(), institutionId: inst.id, name, startsAt: range.startsAt, endsAt: range.endsAt, isCurrent: false, createdAt: new Date().toISOString() };
      if (body.isCurrent === true) { for (const y of store.academicYears || []) if (y.institutionId === inst.id) y.isCurrent = false; item.isCurrent = true; }
      store.academicYears.unshift(item); audit(req.auth, 'created academic year', name); await persist(); send(res, 201, { academicYear: item });
    }).catch(e => send(res, 400, { error: e.message }));
  }
  if (req.method === 'PATCH' && /^\/api\/admin\/academic-years\/[^/]+$/.test(url.pathname)) return readBody(req).then(async body => {
    if (!needOrgManage()) return;
    const y = (store.academicYears || []).find(x => x.id === url.pathname.split('/')[4]);
    if (!y) return send(res, 404, { error: 'Academic year not found.' });
    if (!scopeInst(y.institutionId)) return;
    if (body.name !== undefined) { const name = org.validName(body.name); if (!name) return send(res, 400, { error: 'Academic year name must be 2 to 120 characters.' }); y.name = name; }
    if (body.startsAt !== undefined || body.endsAt !== undefined) {
      const range = org.validDateRange(body.startsAt !== undefined ? body.startsAt : y.startsAt, body.endsAt !== undefined ? body.endsAt : y.endsAt);
      if (!range) return send(res, 400, { error: 'Provide valid start and end dates with the end after the start.' });
      y.startsAt = range.startsAt; y.endsAt = range.endsAt;
    }
    if (body.isCurrent === true) { for (const o of store.academicYears || []) if (o.institutionId === y.institutionId) o.isCurrent = false; y.isCurrent = true; }
    else if (body.isCurrent === false) y.isCurrent = false;
    audit(req.auth, 'updated academic year', y.name); await persist(); send(res, 200, { academicYear: y });
  }).catch(e => send(res, 400, { error: e.message }));
  if (req.method === 'DELETE' && /^\/api\/admin\/academic-years\/[^/]+$/.test(url.pathname)) {
    if (!needOrgManage()) return;
    const y = (store.academicYears || []).find(x => x.id === url.pathname.split('/')[4]);
    if (!y) return send(res, 404, { error: 'Academic year not found.' });
    if (!scopeInst(y.institutionId)) return;
    if ((store.semesters || []).some(sm => sm.academicYearId === y.id)) return send(res, 409, { error: 'Delete its semesters first.' });
    store.academicYears = store.academicYears.filter(x => x.id !== y.id);
    audit(req.auth, 'deleted academic year', y.name); return persist().then(() => send(res, 200, { deleted: true }));
  }
  if (/^\/api\/admin\/academic-years\/[^/]+\/semesters$/.test(url.pathname)) {
    const yid = url.pathname.split('/')[4];
    const y = (store.academicYears || []).find(x => x.id === yid);
    if (!y) return send(res, 404, { error: 'Academic year not found.' });
    if (!scopeInst(y.institutionId)) return;
    if (req.method === 'GET') {
      if (!orgCanRead) return send(res, 403, { error: 'Organization access is not permitted for your role.' });
      return send(res, 200, { semesters: (store.semesters || []).filter(sm => sm.academicYearId === yid) });
    }
    if (req.method === 'POST') return readBody(req).then(async body => {
      if (!needOrgManage()) return;
      const name = org.validName(body.name); if (!name) return send(res, 400, { error: 'Semester name must be 2 to 120 characters.' });
      const range = org.validDateRange(body.startsAt, body.endsAt);
      if (!range) return send(res, 400, { error: 'Provide valid start and end dates with the end after the start.' });
      const item = { id: randomUUID(), academicYearId: yid, institutionId: y.institutionId, name, startsAt: range.startsAt, endsAt: range.endsAt, isCurrent: false, createdAt: new Date().toISOString() };
      if (body.isCurrent === true) { for (const sm of store.semesters || []) if (sm.academicYearId === yid) sm.isCurrent = false; item.isCurrent = true; }
      store.semesters.unshift(item); audit(req.auth, 'created semester', name); await persist(); send(res, 201, { semester: item });
    }).catch(e => send(res, 400, { error: e.message }));
  }
  if (req.method === 'PATCH' && /^\/api\/admin\/academic-years\/[^/]+\/semesters\/[^/]+$/.test(url.pathname)) return readBody(req).then(async body => {
    if (!needOrgManage()) return;
    const parts = url.pathname.split('/'), yid = parts[4], sid = parts[6];
    const sm = (store.semesters || []).find(x => x.id === sid && x.academicYearId === yid);
    if (!sm) return send(res, 404, { error: 'Semester not found.' });
    if (!scopeInst(sm.institutionId)) return;
    if (body.name !== undefined) { const name = org.validName(body.name); if (!name) return send(res, 400, { error: 'Semester name must be 2 to 120 characters.' }); sm.name = name; }
    if (body.startsAt !== undefined || body.endsAt !== undefined) {
      const range = org.validDateRange(body.startsAt !== undefined ? body.startsAt : sm.startsAt, body.endsAt !== undefined ? body.endsAt : sm.endsAt);
      if (!range) return send(res, 400, { error: 'Provide valid start and end dates with the end after the start.' });
      sm.startsAt = range.startsAt; sm.endsAt = range.endsAt;
    }
    if (body.isCurrent === true) { for (const o of store.semesters || []) if (o.academicYearId === yid) o.isCurrent = false; sm.isCurrent = true; }
    else if (body.isCurrent === false) sm.isCurrent = false;
    audit(req.auth, 'updated semester', sm.name); await persist(); send(res, 200, { semester: sm });
  }).catch(e => send(res, 400, { error: e.message }));
  if (req.method === 'DELETE' && /^\/api\/admin\/academic-years\/[^/]+\/semesters\/[^/]+$/.test(url.pathname)) {
    if (!needOrgManage()) return;
    const parts = url.pathname.split('/'), yid = parts[4], sid = parts[6];
    const sm = (store.semesters || []).find(x => x.id === sid && x.academicYearId === yid);
    if (!sm) return send(res, 404, { error: 'Semester not found.' });
    if (!scopeInst(sm.institutionId)) return;
    if ((store.courses || []).some(c => c.semesterId === sid)) return send(res, 409, { error: 'Semester is in use by courses.' });
    store.semesters = store.semesters.filter(x => x.id !== sid);
    audit(req.auth, 'deleted semester', sm.name); return persist().then(() => send(res, 200, { deleted: true }));
  }
  if (url.pathname === '/api/admin/role-permissions') {
    const KNOWN_ROLES = ['super_admin', 'institution_admin', 'teacher', 'student'];
    const KNOWN_PERMS = ['org.manage', 'org.view', 'users.manage', 'courses.manage', 'courses.create', 'courses.publish', 'assignments.manage', 'assignments.submit', 'courses.enroll', 'fees.manage', 'marketplace.manage', 'import.manage', 'reports.view', 'settings.manage', 'branding.manage', 'roles.manage', 'integrations.manage', 'library.manage', 'calendar.manage', 'lang.manage', 'standards.manage', 'codelab.manage'];
    if (req.method === 'GET') {
      if (!org.can(req.auth, 'roles.manage')) return send(res, 403, { error: 'Role management is not permitted for your role.' });
      return send(res, 200, { roles: KNOWN_ROLES, permissions: KNOWN_PERMS, matrix: store.rolePermissions || {} });
    }
    if (req.method === 'PATCH') return readBody(req).then(async body => {
      if (org.effectiveRole(req.auth.role) !== 'super_admin') return send(res, 403, { error: 'Only a super administrator can edit role permissions.' });
      const matrix = body.rolePermissions || body.matrix;
      if (!matrix || typeof matrix !== 'object' || Array.isArray(matrix)) return send(res, 400, { error: 'Provide a rolePermissions object.' });
      for (const [role, perms] of Object.entries(matrix)) {
        if (!KNOWN_ROLES.includes(role)) return send(res, 400, { error: `Unknown role: ${role}.` });
        if (!Array.isArray(perms) || perms.some(p => !KNOWN_PERMS.includes(p))) return send(res, 400, { error: `Role ${role}: permissions must be known permission strings.` });
        if (role === 'super_admin' && !perms.includes('roles.manage')) return send(res, 400, { error: 'super_admin must keep roles.manage.' });
      }
      for (const [role, perms] of Object.entries(matrix)) store.rolePermissions[role] = [...new Set(perms)];
      audit(req.auth, 'updated role permissions', Object.keys(matrix).join(',')); await persist();
      send(res, 200, { matrix: store.rolePermissions });
    }).catch(e => send(res, 400, { error: e.message }));
  }
  if (req.method === 'GET' && url.pathname === '/api/admin/settings') return send(res,200,{settings:publicSettings()});
  if (req.method === 'PATCH' && url.pathname === '/api/admin/settings') return readBody(req).then(async body=>{ if(!hasPerm('admin','canManageSettings')) return send(res,403,{error:'Settings management is disabled.'}); const st=store.settings; if(body.platformName!==undefined) st.platformName=String(body.platformName).slice(0,80)||'EduVerse 3D'; if(body.institution!==undefined) st.institution=String(body.institution).slice(0,120); if(body.timezone!==undefined) st.timezone=String(body.timezone).slice(0,60); if(body.locale!==undefined) st.locale=String(body.locale).slice(0,20); if(body.defaultTheme!==undefined&&['light','dark','system'].includes(body.defaultTheme)) st.defaultTheme=body.defaultTheme; if(body.maintenanceMessage!==undefined) st.maintenanceMessage=String(body.maintenanceMessage).slice(0,300); if(body.maxUploadMB!==undefined){ const n=Number(body.maxUploadMB); if(Number.isInteger(n)&&n>=1&&n<=500) st.maxUploadMB=n; } if(typeof body.allowStudentRegistration==='boolean') st.allowStudentRegistration=body.allowStudentRegistration; if(typeof body.requireTeacherApproval==='boolean') st.requireTeacherApproval=body.requireTeacherApproval; audit(req.auth,'updated platform settings',st.platformName); await persist(); send(res,200,{settings:publicSettings()}); }).catch(e=>send(res,400,{error:e.message}));
  if (req.method === 'GET' && url.pathname === '/api/admin/courses') {const scope=org.orgScope(req.auth);const list=scope.institutionId?(store.courses||[]).filter(c=>c.institutionId===scope.institutionId):(store.courses||[]);return send(res,200,{courses:list.map(c=>({...c,ownerName:store.users.find(u=>u.id===c.ownerId)?.name||'Catalog',enrolled:(store.enrollments||[]).filter(e=>e.courseId===c.id).length}))});}
  if (req.method === 'PATCH' && /^\/api\/admin\/courses\/[^/]+$/.test(url.pathname)) return readBody(req).then(async body=>{ if(!hasPerm('admin','canManageCourses')) return send(res,403,{error:'Course management is disabled.'}); const id=url.pathname.split('/').at(-1),course=(store.courses||[]).find(c=>c.id===id); if(!course) return send(res,404,{error:'Course not found.'}); if(body.status!==undefined){ if(!['draft','published','archived'].includes(body.status)) return send(res,400,{error:'Invalid status.'}); course.status=body.status; } if(body.ownerId!==undefined){ const owner=store.users.find(u=>u.id===body.ownerId&&u.role==='teacher'&&u.status==='active'); if(!owner) return send(res,400,{error:'Assign an approved teacher.'}); course.ownerId=owner.id; } if(body.priceCents!==undefined){const p=Math.floor(Number(body.priceCents));if(!Number.isInteger(p)||p<0||p>100000000)return send(res,400,{error:'Course price must be 0 to 100,000,000 cents.'});course.priceCents=p;}
    if(body.currency!==undefined){if(!/^[A-Z]{3}$/.test(String(body.currency)))return send(res,400,{error:'Currency must be a 3-letter code.'});course.currency=String(body.currency);}
    const scope3=org.orgScope(req.auth),instForCourse=scope3.institutionId||course.institutionId||null;
    if(body.institutionId!==undefined){ if(org.effectiveRole(req.auth.role)!=='super_admin')return send(res,403,{error:'Only a super administrator can move courses between institutions.'}); const inst=(store.institutions||[]).find(i=>i.id===body.institutionId); if(!inst)return send(res,400,{error:'Choose an existing institution.'}); course.institutionId=inst.id; course.campusId=null; course.departmentId=null; course.semesterId=null; }
    const ci=course.institutionId||null;
    if(body.campusId!==undefined){if(!body.campusId)course.campusId=null;else{const cp=(store.campuses||[]).find(c=>c.id===body.campusId&&(!ci||c.institutionId===ci));if(!cp||(scope3.institutionId&&cp.institutionId!==scope3.institutionId))return send(res,400,{error:'Choose a campus in this institution.'});course.campusId=cp.id;}}
    if(body.departmentId!==undefined){if(!body.departmentId)course.departmentId=null;else{const dp=(store.departments||[]).find(d=>d.id===body.departmentId&&(!ci||d.institutionId===ci));if(!dp||(scope3.institutionId&&dp.institutionId!==scope3.institutionId))return send(res,400,{error:'Choose a department in this institution.'});course.departmentId=dp.id;}}
    if(body.semesterId!==undefined){if(!body.semesterId)course.semesterId=null;else{const sm=(store.semesters||[]).find(s=>s.id===body.semesterId&&(!ci||s.institutionId===ci));if(!sm||(scope3.institutionId&&sm.institutionId!==scope3.institutionId))return send(res,400,{error:'Choose a semester in this institution.'});course.semesterId=sm.id;}}
    audit(req.auth,'updated course',course.title); await persist(); send(res,200,{course}); }).catch(e=>send(res,400,{error:e.message}));
  if (req.method === 'GET' && url.pathname === '/api/admin/enrollments') return send(res,200,{enrollments:(store.enrollments||[]).map(e=>({...e,studentName:store.users.find(u=>u.id===e.studentId)?.name||'',courseTitle:(store.courses||[]).find(c=>c.id===e.courseId)?.title||''})),classes:(store.classes||[]).map(c=>({...c,students:c.studentIds.map(id=>store.users.find(u=>u.id===id)).filter(Boolean).map(publicUser)}))});
  if (req.method === 'POST' && url.pathname === '/api/admin/enrollments') return readBody(req).then(async body=>{
    const target=body.classId?`class:${body.classId}:enroll`:body.courseId?`course:${body.courseId}:admin-enroll`:'enrollment:create';
    const result=await executeIdempotent({actorId:req.auth.id,scope:target,key:req.headers['idempotency-key'],payload:body},async()=>{
      if(body.classId){
        const klass=(store.classes||[]).find(c=>c.id===body.classId);
        if(!klass)return {status:404,payload:{error:'Class not found.'}};
        if(!store.users.some(u=>u.id===body.studentId&&u.role==='student'&&u.status==='active'))return {status:400,payload:{error:'Only active students can be enrolled.'}};
        klass.studentIds ||= [];
        if(klass.studentIds.includes(body.studentId))return {status:200,payload:{class:klass,enrolled:true}};
        klass.studentIds.push(body.studentId);
        audit(req.auth,'enrolled student in class',klass.name);
        return {status:201,payload:{class:klass,enrolled:true},changed:true};
      }
      if(body.courseId){
        if(!(store.courses||[]).some(c=>c.id===body.courseId))return {status:404,payload:{error:'Course not found.'}};
        if(!store.users.some(u=>u.id===body.studentId&&u.role==='student'&&u.status==='active'))return {status:400,payload:{error:'Only active students can be enrolled.'}};
        if((store.enrollments||[]).some(e=>e.studentId===body.studentId&&e.courseId===body.courseId))return {status:200,payload:{enrolled:true}};
        store.enrollments.push({id:randomUUID(),studentId:body.studentId,courseId:body.courseId,enrolledAt:new Date().toISOString()});
        audit(req.auth,'enrolled student in course',body.courseId);
        return {status:201,payload:{enrolled:true},changed:true};
      }
      return {status:400,payload:{error:'Provide classId or courseId.'}};
    });
    return send(res,result.status,result.payload);
  }).catch(e=>send(res,400,{error:e.message}));
  if (req.method === 'GET' && url.pathname === '/api/admin/reports') { const users=store.users||[],classes=store.classes||[],assignments=store.assignments||[]; const completionRows=(store.enrollments||[]).map(e=>{ const course=(store.courses||[]).find(c=>c.id===e.courseId); const total=(course?.modules||[]).reduce((n,m)=>n+((m.lessons||[]).length||1),0)||1; const done=(store.courseLessonProgress[`${e.studentId}:${e.courseId}`]||[]).length; return {studentId:e.studentId,studentName:users.find(u=>u.id===e.studentId)?.name||'',courseTitle:course?.title||'',completion:Math.round(done/total*100)}; }); const attendance=(Object.values(store.teacherWorkspaces||{}).flatMap(w=>w.attendance||[]).flatMap(a=>a.attendance||[])); return send(res,200,{users:users.map(publicUser),classes:classes.map(c=>({id:c.id,name:c.name,subject:c.subject,teachers:(c.teacherIds||[]).length,students:(c.studentIds||[]).length})),assignments:assignments.map(a=>({id:a.id,title:a.title,assigned:(a.studentIds||[]).length,submitted:Object.keys(a.submissions||{}).length,graded:Object.values(a.submissions||{}).filter(x=>x.grade?.releasedAt).length})),completion:completionRows,attendance:{total:attendance.length,present:attendance.filter(a=>a.status==='present').length,absent:attendance.filter(a=>a.status==='absent').length,late:attendance.filter(a=>a.status==='late').length},visionEvents:Object.values(store.userVision||{}).flatMap(v=>v.events||[]).length}); }
  if (req.method === 'GET' && url.pathname === '/api/admin/reports/export') { const type=url.searchParams.get('type')||'users'; let rows=[['name','email','role','status','createdAt']]; if(type==='users') rows.push(...store.users.map(u=>[u.name,u.email,u.role,u.status,u.createdAt])); else if(type==='enrollments') { rows=[['student','course','enrolledAt']]; rows.push(...(store.enrollments||[]).map(e=>[store.users.find(u=>u.id===e.studentId)?.name||'',(store.courses||[]).find(c=>c.id===e.courseId)?.title||'',e.enrolledAt])); } else if(type==='completion') { rows=[['student','course','completionPct']]; rows.push(...(store.enrollments||[]).map(e=>{ const course=(store.courses||[]).find(c=>c.id===e.courseId); const total=(course?.modules||[]).reduce((n,m)=>n+((m.lessons||[]).length||1),0)||1; const done=(store.courseLessonProgress[`${e.studentId}:${e.courseId}`]||[]).length; return [store.users.find(u=>u.id===e.studentId)?.name||'',course?.title||'',Math.round(done/total*100)]; })); } else return send(res,400,{error:'Unknown export type.'}); return sendText(res,200,rows.map(r=>r.map(csvEscape).join(',')).join('\n')); }
  if (req.method === 'GET' && url.pathname === '/api/admin/services') { const visionEvents=Object.values(store.userVision||{}).flatMap(v=>v.events||[]); return probeOpenCv().then(available=>send(res,200,{api:{ok:true},opencv:{available,url:'http://127.0.0.1:4174'},counts:{users:store.users.length,classes:(store.classes||[]).length,courses:(store.courses||[]).length,visionEvents:visionEvents.length},settings:publicSettings(),sessions:sessions.size})); }
  if (req.method === 'PATCH' && /^\/api\/admin\/classes\/[^/]+$/.test(url.pathname)) return readBody(req).then(async body=>{ const id=url.pathname.split('/').at(-1),klass=(store.classes||[]).find(c=>c.id===id); if(!klass) return send(res,404,{error:'Class not found.'}); if(body.name!==undefined){ const n=String(body.name).trim(); if(n.length<2||n.length>100) return send(res,400,{error:'Class name must be 2 to 100 characters.'}); klass.name=n; } if(Array.isArray(body.studentIds)){ if(body.studentIds.some(sid=>!store.users.some(u=>u.id===sid&&u.role==='student'&&u.status==='active'))) return send(res,400,{error:'Only active students can be enrolled.'}); klass.studentIds=[...new Set(body.studentIds)]; } if(Array.isArray(body.teacherIds)){ if(!body.teacherIds.length||body.teacherIds.some(tid=>!store.users.some(u=>u.id===tid&&u.role==='teacher'&&u.status==='active'))) return send(res,400,{error:'Select at least one approved teacher.'}); klass.teacherIds=[...new Set(body.teacherIds)]; } audit(req.auth,'updated class',klass.name); await persist(); send(res,200,{class:klass}); }).catch(e=>send(res,400,{error:e.message}));


  // ---- Operations (Slice B): fees, subscriptions, marketplace, reports, import, analytics ----
  const needPerm = (perm, msg) => { if (!org.can(req.auth, perm)) { send(res, 403, { error: msg || 'Not permitted for your role.' }); return false; } return true; };
  const opsInstId = (body) => {
    const s = org.orgScope(req.auth);
    if (s.institutionId) return s.institutionId;
    if (body && body.institutionId) {
      const inst = (store.institutions || []).find(i => i.id === body.institutionId);
      if (!inst) return null;
      return inst.id;
    }
    return (store.institutions[0] || {}).id || null;
  };
  const feeWithStatus = (r) => {
    const st = (store.feeStructures || []).find(f => f.id === r.feeStructureId);
    return { ...r, status: ops.feeStatus(r), structureName: st ? st.name : (r.note || 'Fee') };
  };

  // ----- Fee structures -----
  if (req.method === 'GET' && url.pathname === '/api/admin/fee-structures') {
    if (!needPerm('fees.manage')) return;
    const s = org.orgScope(req.auth);
    const qInst = url.searchParams.get('institutionId'), qYear = url.searchParams.get('academicYearId');
    if (qInst && !scopeInst(qInst)) return;
    const list = (store.feeStructures || []).filter(f =>
      (!s.institutionId || f.institutionId === s.institutionId) &&
      (!qInst || f.institutionId === qInst) &&
      (!qYear || f.academicYearId === qYear));
    return send(res, 200, { feeStructures: list });
  }
  if (req.method === 'POST' && url.pathname === '/api/admin/fee-structures') return readBody(req).then(async body => {
    if (!needPerm('fees.manage')) return;
    const institutionId = opsInstId(body);
    if (!institutionId) return send(res, 400, { error: 'Choose an institution.' });
    if (!scopeInst(institutionId)) return;
    const v = ops.validateFeeStructure(body);
    if (v.error) return send(res, 400, { error: v.error });
    let academicYearId = null;
    if (body.academicYearId) {
      const y = (store.academicYears || []).find(a => a.id === body.academicYearId && a.institutionId === institutionId);
      if (!y) return send(res, 400, { error: 'Choose an academic year in this institution.' });
      academicYearId = y.id;
    }
    const fs = { id: randomUUID(), institutionId, academicYearId, ...v.value, currency: 'INR', createdAt: new Date().toISOString() };
    store.feeStructures.unshift(fs);
    audit(req.auth, 'created fee structure', fs.name); await persist();
    send(res, 201, { feeStructure: fs });
  }).catch(e => send(res, 400, { error: e.message }));
  if (req.method === 'PATCH' && /^\/api\/admin\/fee-structures\/[^/]+$/.test(url.pathname)) return readBody(req).then(async body => {
    if (!needPerm('fees.manage')) return;
    const fs = (store.feeStructures || []).find(f => f.id === url.pathname.split('/')[4]);
    if (!fs || !scopeInst(fs.institutionId)) return send(res, 404, { error: 'Fee structure not found.' });
    if (body.name !== undefined) { const n = String(body.name).trim(); if (n.length < 2 || n.length > 120) return send(res, 400, { error: 'Fee name must be 2 to 120 characters.' }); fs.name = n; }
    if (body.amount !== undefined) { const a = ops.validMoney(body.amount); if (a === null || a <= 0) return send(res, 400, { error: 'Amount must be positive.' }); fs.amount = a; }
    if (body.dueDate !== undefined) { const t = new Date(String(body.dueDate)).getTime(); if (!Number.isFinite(t)) return send(res, 400, { error: 'Invalid due date.' }); fs.dueDate = new Date(t).toISOString(); }
    if (body.grade !== undefined) fs.grade = String(body.grade).slice(0, 50) || null;
    audit(req.auth, 'updated fee structure', fs.name); await persist();
    send(res, 200, { feeStructure: fs });
  }).catch(e => send(res, 400, { error: e.message }));
  if (req.method === 'DELETE' && /^\/api\/admin\/fee-structures\/[^/]+$/.test(url.pathname)) {
    if (!needPerm('fees.manage')) return;
    const id = url.pathname.split('/')[4];
    const fs = (store.feeStructures || []).find(f => f.id === id);
    if (!fs || !scopeInst(fs.institutionId)) return send(res, 404, { error: 'Fee structure not found.' });
    if ((store.feeRecords || []).some(r => r.feeStructureId === id)) return send(res, 409, { error: 'Fee structure has payment records and cannot be deleted.' });
    store.feeStructures = store.feeStructures.filter(f => f.id !== id);
    audit(req.auth, 'deleted fee structure', fs.name);
    return persist().then(() => send(res, 200, { deleted: true }));
  }
  if (req.method === 'POST' && /^\/api\/admin\/fee-structures\/[^/]+\/assign$/.test(url.pathname)) return readBody(req).then(async body => {
    if (!needPerm('fees.manage')) return;
    const fs = (store.feeStructures || []).find(f => f.id === url.pathname.split('/')[4]);
    if (!fs || !scopeInst(fs.institutionId)) return send(res, 404, { error: 'Fee structure not found.' });
    let targets = (store.users || []).filter(u => u.role === 'student' && u.status === 'active' && u.institutionId === fs.institutionId);
    if (Array.isArray(body.studentIds) && body.studentIds.length) {
      const ids = new Set(body.studentIds.map(String));
      targets = targets.filter(u => ids.has(u.id));
    } else if (body.grade) {
      const g = String(body.grade).trim().toLowerCase();
      targets = targets.filter(u => String(u.grade || '').trim().toLowerCase() === g);
    }
    if (!targets.length) return send(res, 400, { error: 'No matching students to assign.' });
    let created = 0, skipped = 0;
    for (const u of targets) {
      if ((store.feeRecords || []).some(r => r.studentId === u.id && r.feeStructureId === fs.id)) { skipped++; continue; }
      const rec = { id: randomUUID(), institutionId: fs.institutionId, studentId: u.id, feeStructureId: fs.id, amountDue: fs.amount, amountPaid: 0, status: 'pending', dueDate: fs.dueDate, payments: [], createdAt: new Date().toISOString() };
      store.feeRecords.unshift(rec);
      created++;
      notify.feeAssigned(u.id, rec).catch(() => {});
    }
    audit(req.auth, 'assigned fee structure', `${fs.name} -> ${created} students`); await persist();
    send(res, 201, { created, skipped });
  }).catch(e => send(res, 400, { error: e.message }));

  // ----- Fee records -----
  if (req.method === 'GET' && url.pathname === '/api/admin/fee-records') {
    if (!needPerm('fees.manage')) return;
    const s = org.orgScope(req.auth);
    const qStudent = url.searchParams.get('studentId'), qStatus = url.searchParams.get('status'), qOverdue = url.searchParams.get('overdue');
    let list = (store.feeRecords || []).filter(r => !s.institutionId || r.institutionId === s.institutionId);
    if (qStudent) list = list.filter(r => r.studentId === qStudent);
    list = list.map(r => ({ ...feeWithStatus(r), studentName: (store.users.find(u => u.id === r.studentId) || {}).name || '' }));
    if (qOverdue === '1') list = list.filter(r => r.status === 'overdue');
    else if (qStatus) list = list.filter(r => r.status === qStatus);
    return send(res, 200, { feeRecords: list });
  }
  // Create a payment order for a fee record (uses configured provider, else test-mode)
  if (req.method === 'POST' && /^\/api\/fee-records\/[^/]+\/order$/.test(url.pathname)) return readBody(req).then(async body => {
    const rec = (store.feeRecords || []).find(r => r.id === url.pathname.split('/')[3]);
    if (!rec) return send(res, 404, { error: 'Fee record not found.' });
    if (req.auth.role !== 'student' || rec.studentId !== req.auth.id) {
      if (!org.can(req.auth, 'fees.manage')) return send(res, 403, { error: 'Not permitted.' });
    }
    const remaining = rec.amountDue - rec.amountPaid;
    if (remaining <= 0) return send(res, 400, { error: 'This fee is already paid in full.' });
    try {
      const order = await payments.createOrder({ amount: remaining * 100, currency: 'INR', receipt: `fee_${rec.id.slice(0, 8)}`, notes: { feeRecordId: rec.id } });
      send(res, 201, { order, feeRecordId: rec.id, amountDue: remaining });
    } catch (e) { send(res, 502, { error: e.message }); }
  }).catch(e => send(res, 400, { error: e.message }));
  if (req.method === 'POST' && url.pathname === '/api/payments/webhook') return readBody(req, { raw: true }).then(async ({ body, raw }) => {
    // Verify webhook signature per provider; test-mode accepts local signature.
    const sig = req.headers['x-razorpay-signature'] || req.headers['stripe-signature'] || req.headers['x-test-signature'];
    const { verified, provider: prov, event } = payments.verifyWebhook({ rawBody: raw, signature: sig, headers: req.headers });
    if (!verified) return send(res, 401, { error: 'Invalid webhook signature.' });
    // In a full implementation, match event to a fee record and mark paid.
    // For now: log the verified event for admin review.
    store.paymentWebhooks ||= [];
    store.paymentWebhooks.unshift({ at: new Date().toISOString(), provider: prov, event: event ? JSON.stringify(event).slice(0, 2000) : null });
    if (store.paymentWebhooks.length > 100) store.paymentWebhooks.length = 100;
    await persist();
    send(res, 200, { received: true, provider: prov });
  }).catch(e => send(res, 400, { error: e.message }));
  if (req.method === 'POST' && /^\/api\/admin\/fee-records\/[^/]+\/pay$/.test(url.pathname)) return readBody(req).then(async body => {
    if (!needPerm('fees.manage')) return;
    const rec = (store.feeRecords || []).find(r => r.id === url.pathname.split('/')[4]);
    if (!rec || !scopeInst(rec.institutionId)) return send(res, 404, { error: 'Fee record not found.' });
    const amount = Math.round(Number(body.amount));
    if (!Number.isFinite(amount) || amount <= 0) return send(res, 400, { error: 'Payment amount must be positive.' });
    if (rec.amountPaid + amount > rec.amountDue) return send(res, 400, { error: `Payment would exceed the due amount (${rec.amountDue - rec.amountPaid} remaining).` });
    const method = String(body.method || 'cash').slice(0, 40);
    rec.payments.push({ at: new Date().toISOString(), amount, method, txnId: randomUUID(), recordedBy: req.auth.id });
    rec.amountPaid += amount;
    audit(req.auth, 'recorded fee payment', `${rec.id}:${amount}`); await persist();
    send(res, 200, { feeRecord: feeWithStatus(rec) });
  }).catch(e => send(res, 400, { error: e.message }));
  if (req.method === 'GET' && url.pathname === '/api/fees/mine') {
    if (req.auth.role !== 'student') return send(res, 403, { error: 'Student access required.' });
    const list = (store.feeRecords || []).filter(r => r.studentId === req.auth.id).map(feeWithStatus);
    const totalDue = list.reduce((n, r) => n + Math.max(0, r.amountDue - r.amountPaid), 0);
    return send(res, 200, { feeRecords: list, totalDue });
  }

  // ----- Subscription plans -----
  if (req.method === 'GET' && url.pathname === '/api/admin/subscription-plans') {
    if (!needPerm('fees.manage')) return;
    return send(res, 200, { plans: store.subscriptionPlans || [] });
  }
  if (req.method === 'POST' && url.pathname === '/api/admin/subscription-plans') return readBody(req).then(async body => {
    if (org.effectiveRole(req.auth.role) !== 'super_admin') return send(res, 403, { error: 'Only a super administrator can create subscription plans.' });
    const v = ops.validatePlan(body);
    if (v.error) return send(res, 400, { error: v.error });
    const plan = { id: randomUUID(), ...v.value, createdAt: new Date().toISOString() };
    store.subscriptionPlans.unshift(plan);
    audit(req.auth, 'created subscription plan', plan.name); await persist();
    send(res, 201, { plan });
  }).catch(e => send(res, 400, { error: e.message }));
  if (req.method === 'GET' && /^\/api\/admin\/institutions\/[^/]+\/subscription$/.test(url.pathname)) {
    if (!needPerm('fees.manage')) return;
    const instId = url.pathname.split('/')[4];
    if (!scopeInst(instId)) return;
    const sub = (store.institutionSubscriptions || []).find(x => x.institutionId === instId && x.status === 'active')
      || (store.institutionSubscriptions || []).filter(x => x.institutionId === instId)[0] || null;
    const plan = sub ? (store.subscriptionPlans || []).find(p => p.id === sub.planId) : null;
    return send(res, 200, { subscription: sub, plan });
  }
  if (req.method === 'POST' && /^\/api\/admin\/institutions\/[^/]+\/subscription$/.test(url.pathname)) return readBody(req).then(async body => {
    if (!needPerm('fees.manage')) return;
    const instId = url.pathname.split('/')[4];
    if (!scopeInst(instId)) return;
    if (!(store.institutions || []).some(i => i.id === instId)) return send(res, 404, { error: 'Institution not found.' });
    const plan = (store.subscriptionPlans || []).find(p => p.id === body.planId);
    if (!plan) return send(res, 400, { error: 'Choose a valid subscription plan.' });
    for (const x of (store.institutionSubscriptions || []).filter(x => x.institutionId === instId && x.status === 'active')) x.status = 'expired';
    const startsAt = new Date().toISOString();
    const sub = { id: randomUUID(), institutionId: instId, planId: plan.id, status: 'active', startsAt, endsAt: ops.subscriptionEndsAt(startsAt, plan.billingCycle), createdAt: startsAt };
    store.institutionSubscriptions.unshift(sub);
    audit(req.auth, 'assigned subscription', `${plan.name} -> ${instId}`); await persist();
    send(res, 201, { subscription: sub, plan });
  }).catch(e => send(res, 400, { error: e.message }));
  if (req.method === 'PATCH' && /^\/api\/admin\/institutions\/[^/]+\/subscription$/.test(url.pathname)) return readBody(req).then(async body => {
    if (!needPerm('fees.manage')) return;
    const instId = url.pathname.split('/')[4];
    if (!scopeInst(instId)) return;
    const sub = (store.institutionSubscriptions || []).find(x => x.institutionId === instId && x.status === 'active');
    if (!sub) return send(res, 404, { error: 'No active subscription.' });
    if (body.status !== 'cancelled') return send(res, 400, { error: 'Only cancellation is supported.' });
    sub.status = 'cancelled';
    audit(req.auth, 'cancelled subscription', instId); await persist();
    send(res, 200, { subscription: sub });
  }).catch(e => send(res, 400, { error: e.message }));

  // ----- Marketplace -----
  if (req.method === 'POST' && url.pathname === '/api/admin/marketplace/listings') return readBody(req).then(async body => {
    if (!needPerm('marketplace.manage')) return;
    const course = (store.courses || []).find(c => c.id === body.courseId);
    if (!course) return send(res, 404, { error: 'Course not found.' });
    if (!scopeInst(course.institutionId)) return;
    if (course.status !== 'published') return send(res, 400, { error: 'Only published courses can be listed.' });
    if ((store.marketplaceListings || []).some(l => l.courseId === course.id && l.status === 'listed')) return send(res, 409, { error: 'Course is already listed.' });
    const price = ops.validMoney(body.price);
    if (price === null) return send(res, 400, { error: 'Price must be a non-negative number (paise).' });
    const listing = { id: randomUUID(), courseId: course.id, institutionId: course.institutionId || null, price, currency: 'INR', status: 'listed', createdAt: new Date().toISOString() };
    store.marketplaceListings.unshift(listing);
    audit(req.auth, 'listed course on marketplace', course.title); await persist();
    await cache.del('marketplace:courses');
    send(res, 201, { listing });
  }).catch(e => send(res, 400, { error: e.message }));
  if (req.method === 'DELETE' && /^\/api\/admin\/marketplace\/listings\/[^/]+$/.test(url.pathname)) {
    if (!needPerm('marketplace.manage')) return;
    const id = url.pathname.split('/')[5];
    const listing = (store.marketplaceListings || []).find(l => l.id === id);
    if (!listing || !scopeInst(listing.institutionId)) return send(res, 404, { error: 'Listing not found.' });
    store.marketplaceListings = store.marketplaceListings.filter(l => l.id !== id);
    audit(req.auth, 'removed marketplace listing', id);
    await cache.del('marketplace:courses');
    return persist().then(() => send(res, 200, { deleted: true }));
  }
  if (req.method === 'GET' && url.pathname === '/api/marketplace/courses') {
    const cacheKey = 'marketplace:courses';
    const cached = await cache.get(cacheKey);
    if (cached) return send(res, 200, cached);
    const list = (store.marketplaceListings || []).filter(l => l.status === 'listed').map(l => {
      const course = (store.courses || []).find(c => c.id === l.courseId);
      const inst = (store.institutions || []).find(i => i.id === l.institutionId);
      if (!course || course.status !== 'published') return null;
      return { listingId: l.id, courseId: course.id, title: course.title, description: String(course.description || '').slice(0, 300), price: l.price, currency: l.currency, institutionName: inst ? inst.name : '', listedAt: l.createdAt };
    }).filter(Boolean);
    const out = { courses: list };
    await cache.set(cacheKey, out, 30);
    return send(res, 200, out);
  }
  if (req.method === 'POST' && /^\/api\/marketplace\/courses\/[^/]+\/enroll$/.test(url.pathname)) return readBody(req).then(async () => {
    if (req.auth.role !== 'student') return send(res, 403, { error: 'Student access required.' });
    const listing = (store.marketplaceListings || []).find(l => l.id === url.pathname.split('/')[4] && l.status === 'listed');
    if (!listing) return send(res, 404, { error: 'Listing not found.' });
    const course = (store.courses || []).find(c => c.id === listing.courseId && c.status === 'published');
    if (!course) return send(res, 404, { error: 'Course is no longer available.' });
    if ((store.enrollments || []).some(e => e.studentId === req.auth.id && e.courseId === course.id)) return send(res, 200, { enrolled: true, already: true });
    store.enrollments.push({ id: randomUUID(), studentId: req.auth.id, courseId: course.id, enrolledAt: new Date().toISOString(), via: 'marketplace' });
    let feeRecord = null;
    if (listing.price > 0) {
      feeRecord = { id: randomUUID(), institutionId: listing.institutionId, studentId: req.auth.id, feeStructureId: null, note: `Marketplace: ${course.title}`, amountDue: listing.price, amountPaid: 0, status: 'pending', dueDate: new Date(Date.now() + 7 * 864e5).toISOString(), payments: [], createdAt: new Date().toISOString() };
      store.feeRecords.unshift(feeRecord);
    }
    audit(req.auth, 'enrolled via marketplace', course.title); await persist();
    notify.marketplacePurchase(req.auth.id, course.title).catch(()=>{});
    await persist();
    send(res, 201, { enrolled: true, feeRecord: feeRecord ? feeWithStatus(feeRecord) : null });
  }).catch(e => send(res, 400, { error: e.message }));

  // ----- Teacher workload report -----
  if (req.method === 'GET' && url.pathname === '/api/admin/reports/teacher-workload') {
    if (!needPerm('reports.view')) return;
    const s = org.orgScope(req.auth);
    const qInst = url.searchParams.get('institutionId'), qSem = url.searchParams.get('semesterId');
    if (qInst && !scopeInst(qInst)) return;
    const instFilter = qInst || s.institutionId || null;
    const teachers = (store.users || []).filter(u => u.role === 'teacher' && u.status === 'active' && (!instFilter || u.institutionId === instFilter));
    const rows = teachers.map(t => {
      const courses = (store.courses || []).filter(c => c.ownerId === t.id && (!instFilter || c.institutionId === instFilter) && (!qSem || c.semesterId === qSem));
      const courseIds = new Set(courses.map(c => c.id));
      const studentIds = new Set((store.enrollments || []).filter(e => courseIds.has(e.courseId)).map(e => e.studentId));
      const sessions = (store.liveSessions || []).filter(x => x.ownerId === t.id && (!instFilter || !x.courseId || courseIds.has(x.courseId)));
      const liveHours = sessions.reduce((n, x) => n + (Number(x.durationMin) || 0) / 60, 0);
      const assumedCourseHours = courses.length * 2;
      return { teacherId: t.id, teacherName: t.name, coursesOwned: courses.length, liveSessions: sessions.length, totalStudents: studentIds.size, hours: Math.round((liveHours + assumedCourseHours) * 10) / 10, hoursNote: 'Live-session hours + 2h assumed per owned course' };
    });
    return send(res, 200, { workload: rows });
  }

  // ----- Enrollment report -----
  if (req.method === 'GET' && url.pathname === '/api/admin/reports/enrollments') {
    if (!needPerm('reports.view')) return;
    const s = org.orgScope(req.auth);
    const qCourse = url.searchParams.get('courseId'), qSem = url.searchParams.get('semesterId'), qInst = url.searchParams.get('institutionId');
    if (qInst && !scopeInst(qInst)) return;
    const instFilter = qInst || s.institutionId || null;
    const rows = (store.enrollments || []).map(e => {
      const u = store.users.find(x => x.id === e.studentId) || {};
      const c = (store.courses || []).find(x => x.id === e.courseId) || {};
      return { studentId: e.studentId, studentName: u.name || '', courseId: e.courseId, courseTitle: c.title || '', enrolledAt: e.enrolledAt, institutionId: c.institutionId || u.institutionId || null, semesterId: c.semesterId || null, via: e.via || 'direct' };
    }).filter(r =>
      (!qCourse || r.courseId === qCourse) &&
      (!qSem || r.semesterId === qSem) &&
      (!instFilter || r.institutionId === instFilter));
    if (url.searchParams.get('format') === 'csv') {
      const head = ['studentId', 'studentName', 'courseId', 'courseTitle', 'enrolledAt', 'institutionId', 'semesterId', 'via'];
      const csv = [head.join(','), ...rows.map(r => head.map(k => csvEscape(r[k] ?? '')).join(','))].join('\n');
      return sendText(res, 200, csv, 'text/csv; charset=utf-8');
    }
    return send(res, 200, { enrollments: rows, count: rows.length });
  }

  // ----- Bulk import -----
  const bulkImport = (role) => async (body) => {
    if (!needPerm('import.manage')) return;
    const institutionId = opsInstId(body);
    if (!institutionId) return send(res, 400, { error: 'Choose an institution.' });
    if (!scopeInst(institutionId)) return;
    const { headers, rows } = ops.parseCsv(body.csv);
    for (const h of ['name', 'username', 'email', 'password']) if (!headers.includes(h)) return send(res, 400, { error: `CSV must include columns: name, username, email, password (optional: grade, section). Missing: ${h}.` });
    const existingUsernames = new Set((store.users || []).map(u => (u.username || '').toLowerCase()));
    const existingEmails = new Set((store.users || []).map(u => (u.email || '').toLowerCase()));
    let created = 0; const skipped = [];
    const pending = role === 'teacher' && store.settings.requireTeacherApproval !== false;
    rows.forEach((cells, i) => {
      const v = ops.validateImportRow(cells, headers, existingUsernames, existingEmails);
      if (v.error) { skipped.push({ row: i + 2, error: v.error }); return; }
      store.users.push({ id: randomUUID(), name: v.value.name, username: v.value.username, email: v.value.email, phone: '', passwordHash: null, _pendingPassword: v.value.password, role, status: pending ? 'pending' : 'active', institutionId, grade: v.value.grade, section: v.value.section, createdAt: new Date().toISOString(), importedAt: new Date().toISOString() });
      existingUsernames.add(v.value.username); existingEmails.add(v.value.email);
      created++;
    });
    // Hash passwords async after validation (keeps per-row errors fast).
    for (const u of store.users) {
      if (u._pendingPassword) { u.passwordHash = await passwordHash(u._pendingPassword); delete u._pendingPassword; }
    }
    audit(req.auth, `bulk-imported ${role}s`, `${created} created, ${skipped.length} skipped`); await persist();
    send(res, 201, { created, skipped });
  };
  if (req.method === 'POST' && url.pathname === '/api/admin/import/students') return readBody(req, { maxBytes: MAX_IMPORT_BODY }).then(bulkImport('student')).catch(e => send(res, 400, { error: e.message }));
  if (req.method === 'POST' && url.pathname === '/api/admin/import/teachers') return readBody(req, { maxBytes: MAX_IMPORT_BODY }).then(bulkImport('teacher')).catch(e => send(res, 400, { error: e.message }));

  // ----- Usage analytics -----
  if (req.method === 'GET' && url.pathname === '/api/admin/analytics/usage') {
    if (!needPerm('reports.view')) return;
    const s = org.orgScope(req.auth);
    const days = Math.max(1, Math.min(365, Number(url.searchParams.get('days')) || 30));
    const cacheKey = `usage:${s.institutionId || 'all'}:${days}`;
    const cached = await cache.get(cacheKey);
    if (cached) return send(res, 200, cached);
    const cutoff = Date.now() - days * 864e5;
    const inWindow = (iso) => { const t = new Date(iso || '').getTime(); return Number.isFinite(t) && t >= cutoff; };
    const scopedUsers = new Set((store.users || []).filter(u => !s.institutionId || u.institutionId === s.institutionId).map(u => u.id));
    const logins = (store.loginEvents || []).filter(e => inWindow(e.at) && (!s.institutionId || scopedUsers.has(e.userId) || (e.institutionId || null) === s.institutionId));
    const enrollments = (store.enrollments || []).filter(e => inWindow(e.enrolledAt) && scopedUsers.has(e.studentId));
    const quizAttempts = (store.quizAttempts || []).filter(a => inWindow(a.startedAt) && scopedUsers.has(a.studentId));
    const liveSessions = (store.liveSessions || []).filter(x => inWindow(x.createdAt || x.startsAt) && (!s.institutionId || !x.ownerId || scopedUsers.has(x.ownerId)));
    let novaCalls = 0;
    for (const stamps of novaAttempts.values()) for (const t of (stamps || [])) if (t >= cutoff) novaCalls++;
    const out = {
      days,
      logins: logins.length,
      activeUsers: new Set(logins.map(e => e.userId)).size,
      enrollments: enrollments.length,
      quizAttempts: quizAttempts.length,
      liveSessions: liveSessions.length,
      novaCalls,
    };
    await cache.set(cacheKey, out, 60);
    return send(res, 200, out);
  }

  // ---- Security & platform (Slice C): login activity, incidents, backup, integrations ----
  if (req.method === 'GET' && url.pathname === '/api/admin/security/logins') {
    if (!needPerm('security.view')) return;
    const s = org.orgScope(req.auth);
    const days = Math.max(1, Math.min(365, Number(url.searchParams.get('days')) || 7));
    const userId = String(url.searchParams.get('userId') || '');
    const cutoff = Date.now() - days * 864e5;
    const scopedUsers = new Set((store.users || []).filter(u => !s.institutionId || u.institutionId === s.institutionId).map(u => u.id));
    const logins = (store.loginEvents || [])
      .filter(e => {
        const t = new Date(e.at || '').getTime();
        if (!Number.isFinite(t) || t < cutoff) return false;
        if (userId && e.userId !== userId) return false;
        if (s.institutionId && !scopedUsers.has(e.userId) && (e.institutionId || null) !== s.institutionId) return false;
        return true;
      })
      .slice(0, 500)
      .map(e => {
        const u = (store.users || []).find(x => x.id === e.userId);
        return { at: e.at, userId: e.userId, name: u ? u.name : '', username: u ? (u.username || '') : '', role: u ? u.role : '', ip: e.ip || '', userAgent: e.userAgent || '' };
      });
    return send(res, 200, { logins, days });
  }

  if (req.method === 'GET' && url.pathname === '/api/admin/security/events') {
    if (!needPerm('security.view')) return;
    const s = org.orgScope(req.auth);
    const days = Math.max(1, Math.min(365, Number(url.searchParams.get('days')) || 7));
    const severity = String(url.searchParams.get('severity') || '');
    const type = String(url.searchParams.get('type') || '');
    const cutoff = Date.now() - days * 864e5;
    const events = (store.securityEvents || [])
      .filter(e => {
        const t = new Date(e.at || '').getTime();
        if (!Number.isFinite(t) || t < cutoff) return false;
        if (severity && e.severity !== severity) return false;
        if (type && e.type !== type) return false;
        if (s.institutionId && (e.institutionId || null) !== s.institutionId) return false;
        return true;
      })
      .slice(0, 500);
    return send(res, 200, { events, days });
  }

  if (req.method === 'GET' && url.pathname === '/api/admin/security/summary') {
    if (!needPerm('security.view')) return;
    const s = org.orgScope(req.auth);
    const days = Math.max(1, Math.min(365, Number(url.searchParams.get('days')) || 7));
    const cutoff = Date.now() - days * 864e5;
    const events = (store.securityEvents || []).filter(e => {
      const t = new Date(e.at || '').getTime();
      if (!Number.isFinite(t) || t < cutoff) return false;
      if (s.institutionId && (e.institutionId || null) !== s.institutionId) return false;
      return true;
    });
    const bySeverity = { low: 0, medium: 0, high: 0, critical: 0 };
    const byType = {};
    for (const e of events) {
      if (bySeverity[e.severity] !== undefined) bySeverity[e.severity]++;
      byType[e.type] = (byType[e.type] || 0) + 1;
    }
    return send(res, 200, { days, total: events.length, bySeverity, byType });
  }

  // ----- Backup -----
  const backupFilename = () => {
    const d = new Date(), p = n => String(n).padStart(2, '0');
    return `eduverse-backup-${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}.json`;
  };
  if (req.method === 'GET' && url.pathname === '/api/admin/backup/download') {
    if (!needPerm('backup.manage')) return;
    if (req.auth.id === 'backup-service') audit({ id: 'backup-service' }, 'downloaded backup (service key)', '');
    const body = JSON.stringify(store, null, 2);
    const filename = backupFilename();
    store.settings.lastBackupAt = new Date().toISOString();
    audit(req.auth, 'downloaded backup', filename);
    return persist().then(() => {
      res.writeHead(200, {
        'Content-Type': 'application/json; charset=utf-8',
        'Content-Disposition': `attachment; filename="${filename}"`,
        'Content-Length': Buffer.byteLength(body),
        'Cache-Control': 'no-store',
        'X-Content-Type-Options': 'nosniff',
        'X-Frame-Options': 'DENY',
      });
      res.end(body);
    }).catch(() => send(res, 500, { error: 'Backup failed.' }));
  }
  if (req.method === 'GET' && url.pathname === '/api/admin/backup/info') {
    if (!needPerm('backup.manage')) return;
    const body = JSON.stringify(store);
    const collections = {};
    for (const [k, v] of Object.entries(store)) collections[k] = Array.isArray(v) ? v.length : (v && typeof v === 'object' ? Object.keys(v).length : 1);
    return send(res, 200, { sizeBytes: Buffer.byteLength(body), collections, lastBackupAt: (store.settings || {}).lastBackupAt || null });
  }
  if (req.method === 'POST' && url.pathname === '/api/admin/backup/restore') return readBody(req, { maxBytes: MAX_BACKUP_BODY }).then(async body => {
    if (org.effectiveRole(req.auth.role) !== 'super_admin') return send(res, 403, { error: 'Only a super administrator can restore backups.' });
    if (body.confirm !== true) return send(res, 400, { error: 'Restoring replaces all data. Send confirm:true to proceed.' });
    const backup = body.backup;
    if (!backup || typeof backup !== 'object' || Array.isArray(backup) || !Array.isArray(backup.users)) {
      return send(res, 400, { error: 'Backup must be an object containing a users array.' });
    }
    store = backup;
    initStoreCollections();
    live.init({ sessions, store, parseCookies, SESSION_MS });
    audit(req.auth, 'restored backup', `${(store.users || []).length} users`);
    await persist();
    send(res, 200, { restored: true, users: (store.users || []).length });
  }).catch(e => send(res, 400, { error: e.message }));

  // ----- Integrations -----
  const INTEGRATION_KINDS = ['email', 'payment', 'storage', 'webhook'];
  const scopedIntegrations = () => {
    const s = org.orgScope(req.auth);
    return (store.integrations || []).filter(i => !s.institutionId || i.institutionId === s.institutionId);
  };
  const integrationInstId = (body) => {
    const s = org.orgScope(req.auth);
    if (s.institutionId) return s.institutionId;
    if (body && body.institutionId && (store.institutions || []).some(i => i.id === body.institutionId)) return body.institutionId;
    return (store.institutions[0] || {}).id || null;
  };
  if (req.method === 'GET' && url.pathname === '/api/admin/integrations') {
    if (!needPerm('integrations.manage')) return;
    return send(res, 200, { integrations: scopedIntegrations().map(sec.redactIntegration) });
  }
  if (req.method === 'POST' && url.pathname === '/api/admin/integrations') return readBody(req).then(async body => {
    if (!needPerm('integrations.manage')) return;
    const kind = String(body.kind || '');
    if (!INTEGRATION_KINDS.includes(kind)) return send(res, 400, { error: 'kind must be email, payment, storage, or webhook.' });
    const name = String(body.name || '').trim();
    if (name.length < 2 || name.length > 120) return send(res, 400, { error: 'Name must be 2 to 120 characters.' });
    const config = body.config && typeof body.config === 'object' && !Array.isArray(body.config) ? body.config : {};
    const row = {
      id: randomUUID(), institutionId: integrationInstId(body), kind, name,
      config, configSecret: String(body.secret || ''),
      status: 'active', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
    };
    store.integrations.unshift(row);
    audit(req.auth, 'added integration', `${kind}:${name}`);
    await persist();
    send(res, 201, { integration: sec.redactIntegration(row) });
  }).catch(e => send(res, 400, { error: e.message }));
  if (req.method === 'PATCH' && /^\/api\/admin\/integrations\/[^/]+$/.test(url.pathname)) return readBody(req).then(async body => {
    if (!needPerm('integrations.manage')) return;
    const row = scopedIntegrations().find(i => i.id === url.pathname.split('/')[4]);
    if (!row) return send(res, 404, { error: 'Integration not found.' });
    if (body.name !== undefined) { const n = String(body.name).trim(); if (n.length < 2 || n.length > 120) return send(res, 400, { error: 'Name must be 2 to 120 characters.' }); row.name = n; }
    if (body.config !== undefined) { if (!body.config || typeof body.config !== 'object' || Array.isArray(body.config)) return send(res, 400, { error: 'config must be an object.' }); row.config = body.config; }
    if (body.secret !== undefined) row.configSecret = String(body.secret || '');
    if (body.status !== undefined) { if (!['active', 'disabled'].includes(body.status)) return send(res, 400, { error: 'status must be active or disabled.' }); row.status = body.status; }
    row.updatedAt = new Date().toISOString();
    audit(req.auth, 'updated integration', row.name);
    await persist();
    send(res, 200, { integration: sec.redactIntegration(row) });
  }).catch(e => send(res, 400, { error: e.message }));
  if (req.method === 'DELETE' && /^\/api\/admin\/integrations\/[^/]+$/.test(url.pathname)) {
    if (!needPerm('integrations.manage')) return;
    const s = org.orgScope(req.auth);
    const idx = (store.integrations || []).findIndex(i => i.id === url.pathname.split('/')[4] && (!s.institutionId || i.institutionId === s.institutionId));
    if (idx < 0) return send(res, 404, { error: 'Integration not found.' });
    const [row] = store.integrations.splice(idx, 1);
    audit(req.auth, 'deleted integration', row.name);
    return persist().then(() => send(res, 200, { deleted: true })).catch(() => send(res, 500, { error: 'Delete failed.' }));
  }
  if (req.method === 'POST' && /^\/api\/admin\/integrations\/[^/]+\/test$/.test(url.pathname)) return readBody(req).then(async body => {
    if (!needPerm('integrations.manage')) return;
    const row = scopedIntegrations().find(i => i.id === url.pathname.split('/')[4]);
    if (!row) return send(res, 404, { error: 'Integration not found.' });
    if (row.kind === 'webhook') {
      const target = String((row.config || {}).url || '').trim();
      if (!/^https?:\/\//.test(target)) return send(res, 400, { ok: false, error: 'Webhook config needs an http(s) url.' });
      const result = await pingWebhook(target);
      audit(req.auth, 'tested integration', row.name);
      await persist();
      return send(res, 200, result);
    }
    const cfg = row.config || {}, missing = [];
    if (row.kind === 'email' && !cfg.from) missing.push('from');
    if (row.kind === 'payment' && !cfg.provider) missing.push('provider');
    if (row.kind === 'storage' && !cfg.bucket) missing.push('bucket');
    if (missing.length) return send(res, 200, { ok: false, error: `Config missing: ${missing.join(', ')}` });
    return send(res, 200, { ok: true, live: false, message: 'Configuration shape looks valid. Credentials are stored (not live-tested).' });
  }).catch(e => send(res, 400, { error: e.message }));

  if (req.method === 'DELETE' && url.pathname === '/api/auth/account') return readBody(req).then(async body=>{
    const user=store.users.find(u=>u.id===req.auth.id); if(!user) return send(res,401,{error:'Sign in required'});
    if(!await passwordMatches(String(body.password||''),user.passwordHash)) return send(res,401,{error:'Current password was not recognized.'});
    if(user.role==='admin'&&store.users.filter(u=>u.role==='admin').length<=1) return send(res,403,{error:'The last administrator account cannot be deleted here.'});
    const id=user.id;
    store.users=store.users.filter(u=>u.id!==id);
    store.loginHistory=(store.loginHistory||[]).filter(h=>h.userId!==id);
    store.notes=(store.notes||[]).filter(n=>n.ownerId!==id);
    if(store.userProgress) delete store.userProgress[id];
    if(store.userAttempts) delete store.userAttempts[id];
    if(store.userVision) delete store.userVision[id];
    if(store.notificationReads) delete store.notificationReads[id];
    if(store.courseLessonProgress) for (const k of Object.keys(store.courseLessonProgress)) if(k.startsWith(id+':')) delete store.courseLessonProgress[k];
    store.enrollments=(store.enrollments||[]).filter(e=>e.studentId!==id);
    for (const c of (store.classes||[])) { c.studentIds=(c.studentIds||[]).filter(x=>x!==id); c.teacherIds=(c.teacherIds||[]).filter(x=>x!==id); }
    for (const a of (store.assignments||[])) if(a.submissions) delete a.submissions[id];
    if(store.teacherWorkspaces) { delete store.teacherWorkspaces[id]; for (const w of Object.values(store.teacherWorkspaces)) for (const t of (w.tests||[])) if(t.attempts) t.attempts=t.attempts.filter(at=>at.studentId!==id); }
    store.visionAssignments=(store.visionAssignments||[]).filter(v=>v.teacherId!==id);
    for (const c of (store.courses||[])) if(c.ownerId===id) { c.ownerId=null; c.status='draft'; }
    store.resetTokens=(store.resetTokens||[]).filter(t=>t.userId!==id);
    jwt.revokeAllForUser(id); store.emailVerifications=(store.emailVerifications||[]).filter(v=>v.userId!==id);
    removeSessionsForUser(id);
    audit({id},'deleted account','account'); await persist(); send(res,200,{ok:true});
  }).catch(e=>send(res,400,{error:e.message}));

function novaReply(user, message) {
  const q = String(message||'').toLowerCase();
  const first = (user.name||'learner').split(/\s+/)[0];
  const has = (...words) => words.some(w => q.includes(w));
  const myAssignments = (store.assignments||[]).filter(a => Array.isArray(a.studentIds) && a.studentIds.includes(user.id));
  const myTodo = myAssignments.filter(a => !a.submissions?.[user.id]);
  const myClasses = (store.classes||[]).filter(c => (c.teacherIds||[]).includes(user.id));
  const myStudents = new Set(myClasses.flatMap(c => c.studentIds||[])).size;
  const awaiting = (store.assignments||[]).filter(a => a.teacherId===user.id).flatMap(a => Object.values(a.submissions||[])).filter(x => !x.grade || !x.grade.releasedAt).length;
  const myEnrollments = (store.enrollments||[]).filter(e => e.studentId===user.id).length;
  const pendingTeachers = (store.users||[]).filter(u => u.role==='teacher' && u.status==='pending').length;
  const all = (text, screen, suggestions) => ({reply: text, screen: screen || null, suggestions: suggestions || []});
  if (has('hello','hi ','hey','good morning','good afternoon','good evening')) return all(`Hi ${first}! I'm Nova, your learning guide. You can ask me about binary search, your courses and assignments, the Vision Lab, attendance, or — if you're a teacher or administrator — your classes and platform tasks. What are you working on?`, null, ['Why do we discard the midpoint?','What assignments do I have?','How do I use the Vision Lab?']);
  if (has('midpoint','binary search','sorted','search boundar')) return all(`Binary search only works on a sorted array. Look at the midpoint: if your target is larger, it cannot be at or below the midpoint, so you discard the midpoint and everything to its left and search the right half. If it is smaller, you discard the right half. Each comparison removes about half of what is left, which is why it is much faster than checking every item. Try it in the lesson player: the array is [3, 8, 12, 17, 21, 29, 34] and the midpoint is 17 — if you are looking for 21, what do you discard?`, 'player', ['Why do we use mid + 1?','What is Big O?']);
  if (has('mid + 1','mid+1','low = mid','low=mid')) return all(`If low stays at mid, the next midpoint can repeat forever when only two values remain. Moving one past the midpoint (low = mid + 1 when the target is larger) guarantees the search space shrinks every step, so the search always finishes. The same idea applies on the other side with high = mid - 1.`, 'player', ['Why do we discard the midpoint?']);
  if (has('big o','complexity','time complexity')) return all(`Binary search takes about log2(n) comparisons: doubling the array only adds roughly one extra comparison. Checking every item one by one is O(n), which grows with the whole array. That is why sorted data plus a midpoint rule is so powerful — and why the first step of binary search is always to sort the data.`, 'player', ['Why do we discard the midpoint?']);
  if (has('assignment','homework','submit','due','grade','feedback','marks')) {
    if (user.role==='teacher') return all(`You have ${awaiting} submission${awaiting===1?'':'s'} awaiting grading or release across your classes. Open Grading to review each submission, add marks and feedback, save a draft grade, or release it — students only see a grade once you release it. Once a grade is released, that student can no longer resubmit it.`, 'teacher-grading', ['How do I create an assignment?','How do I see my students?']);
    if (user.role==='admin') return all(`Assignments are created by teachers for their assigned classes. You can see assignment totals on the Reports page, and you can oversee courses from Course oversight — but grading itself stays with the teacher of that class.`, 'admin-reports', ['How many users are registered?','What is pending approval?']);
    return all(myAssignments.length ? `You have ${myTodo.length} assignment${myTodo.length===1?'':'s'} still to do out of ${myAssignments.length} assigned. Open Assignments to submit your work; once your teacher releases a grade you will see the marks and feedback there.` : `No assignments are assigned to you yet. When a teacher posts class work, it will appear on your Assignments page.`, 'assignments', ['What courses am I enrolled in?','How do I use the Vision Lab?']);
  }
  if (has('course','enrol','catalog','lesson','syllabus')) {
    if (user.role==='teacher') return all(`You can create a course from Teaching courses: start it as a draft, add modules, lessons and linked resources, then publish it when it is ready — drafts stay hidden from students. Publishing can be switched off for all teachers by an administrator in Roles & permissions.`, 'teacher-courses', ['How do I grade an assignment?','How do I assign a Vision Lab experiment?']);
    return all(myEnrollments ? `You are enrolled in ${myEnrollments} course${myEnrollments===1?'':'s'}. Open the Course catalog to browse more, and My enrollments on that page to see what you have already joined and which lessons you have completed.` : `Open the Course catalog to browse guided courses and labs, then use Enroll on a course card to join it. Published teacher courses appear there too.`, 'catalog', ['What assignments do I have?','How do I use the Vision Lab?']);
  }
  if (has('vision','webcam','gesture','drawing','experiment','lab','hand tracking','opencv')) return all(`The Vision & Simulation Lab has 20 activities — webcam drawing, air keyboard, gesture training, physics, chemistry, cell biology, circuits and more. For webcam drawing, press Start camera, allow access, and raise only your index finger to draw; an open palm lifts the pen. Frames are processed on this computer and are not stored. Teachers can assign an experiment to a class from Vision lab assignments.`, 'vision-lab', ['How do I start the webcam drawing?','What assignments do I have?']);
  if (has('attendance','present','absent')) {
    if (user.role==='teacher') return all(`You teach ${myClasses.length} class${myClasses.length===1?'':'es'} with ${myStudents} student${myStudents===1?'':'s'} in total. Take attendance from your Attendance page: choose a class, mark each student present, absent or late, and save — the totals feed into your Learning analytics.`, 'teacher-attendance', ['How do I see my students?','How do I grade an assignment?']);
    return all(`Attendance is recorded by your teacher for each class session. If a session looks wrong, ask your teacher or send feedback from the Send feedback page — students cannot edit attendance themselves.`, null, ['What assignments do I have?','What courses am I enrolled in?']);
  }
  if (has('progress','twin','mastery','streak','score','xp','badge')) return all(`Your Learning twin estimates mastery from your recorded practice — it is an estimate from several signals, not a label. One mistake never defines your ability. Open Profile & progress to see your streak, skill map and vision badges, and keep practising the concepts marked as building.`, 'profile', ['Why do we discard the midpoint?','What assignments do I have?']);
  if (has('password','forgot','recover','account','delete','sign in','login')) return all(`To change your password while signed in, use Account security (teacher) or Security & MFA (administrator), or Profile for students — changing it signs out all of your sessions, so sign in again with the new password. If you cannot sign in at all, use Forgot password and ask an administrator for a one-time recovery code; it expires in 15 minutes and is shown to the administrator only once. To delete your account permanently, use the Delete my account section on the same pages.`, null, ['How do I delete my account?']);
  if (has('class','student','roster','teach')) {
    if (user.role==='teacher') return all(`You teach ${myClasses.length} class${myClasses.length===1?'':'es'} with ${myStudents} student${myStudents===1?'':'s'} in total. Your Students page lists only the learners in your assigned classes, with their progress, attendance and assignment history — you cannot browse unrelated classes.`, 'teacher-students', ['How do I take attendance?','How do I create an assignment?']);
    if (user.role==='admin') return all(`Classes are created from Classes & enrollment, where you assign teachers and students. You can also manage institutions, departments and academic terms from Institutions & terms.`, 'admin-classes', ['How many users are registered?','What is pending approval?']);
    return all(`Your classes are assigned by an administrator. If you cannot see a class you expect, check with your teacher or an administrator — students only see their own enrolled classes.`, null, ['What courses am I enrolled in?']);
  }
  if (has('approve','pending','teacher request','reject','suspend','restore')) {
    if (user.role==='admin') return all(pendingTeachers ? `There ${pendingTeachers===1?'is':'are'} ${pendingTeachers} teacher request${pendingTeachers===1?'':'s'} waiting for approval. Open Users & approvals to approve or reject them, and use the same page to suspend, activate or restore accounts — sensitive actions there ask for confirmation first.` : `No teacher requests are pending right now. Open Users & approvals to review all accounts, or Teachers to see approved and pending teachers.`, 'admin-users', ['How many users are registered?','How do I see reports?']);
    if (user.role==='teacher') return all(`Teacher requests are reviewed by an administrator before teaching tools are enabled. If you signed up as a teacher and cannot sign in yet, your request is still waiting — an administrator approves it from Users & approvals.`, null, ['What can you do?']);
    return all(`Only administrators can approve teacher requests. If you want to teach, sign up as a teacher and an administrator will review your request.`, null, ['What can you do?']);
  }
  if (has('user','report','audit','setting','permission','platform','institution','enroll')) {
    if (user.role==='admin') return all(`As an administrator you can manage users from Users & approvals, permissions from Roles & permissions, platform settings from Platform settings, and activity from Reports and the Audit log. Every sensitive admin action is recorded with who did it, what changed, and when.`, 'admin', ['What is pending approval?','How many users are registered?']);
    return all(`User administration, permissions, platform settings and audit reports are administrator-only. Your own account settings are on your Profile and Account security pages.`, null, ['What can you do?']);
  }
  if (has('help','what can you do','who are you','nova','how do i','how to')) return all(`I'm Nova, EduVerse's guided learning assistant — I answer from the app's own content and your account, I am not a live AI chat service. Ask me about a topic like binary search, or about your courses, assignments, Vision Lab, attendance, or account. Try one of the suggestions below, or just type your question.`, null, ['Why do we discard the midpoint?','What assignments do I have?','How do I use the Vision Lab?']);
  return all(`I don't have a confident answer for that one, ${first} — I'm a guided assistant, not a live AI service, so I stick to EduVerse topics rather than guessing. Try asking about binary search, your courses or assignments, the Vision Lab, attendance, or your account. If something in the app looks broken, use Send feedback and describe what happened.`, null, ['Why do we discard the midpoint?','What assignments do I have?','How do I use the Vision Lab?']);
}

/* ---- Nova chat history (ChatGPT-style) ---- */
const NOVA_CHAT_MAX = 20;
const NOVA_DEFAULT_SUGGESTIONS = ['Why do we discard the midpoint?','What assignments do I have?','How do I use the Vision Lab?'];
function getNovaChat(userId) {
  store.novaChats ||= {};
  const chat = store.novaChats[userId] ||= { messages: [], updatedAt: new Date().toISOString() };
  if (!Array.isArray(chat.messages)) chat.messages = [];
  return chat;
}
function appendNovaChat(userId, role, content) {
  const chat = getNovaChat(userId);
  chat.messages.push({ role, content, at: new Date().toISOString() });
  chat.messages = chat.messages.slice(-NOVA_CHAT_MAX);
  chat.updatedAt = new Date().toISOString();
  return chat;
}
/* 3 short follow-ups, loosely derived from the reply, else the defaults. */
function novaSuggestions(reply) {
  const q = String(reply || '').toLowerCase();
  const out = [];
  const add = (s) => { if (s && !out.includes(s)) out.push(s); };
  if (q.includes('example')) add('Give me another example');
  if (q.includes('practice') || q.includes('quiz') || q.includes('try it')) add('Give me a practice question on this');
  if (q.includes('step')) add('Walk me through the next step');
  if (q.includes('binary search') || q.includes('midpoint')) add('Why do we discard the midpoint?');
  if (q.includes('assignment')) add('What assignments do I have?');
  if (q.includes('vision') || q.includes('webcam')) add('How do I use the Vision Lab?');
  for (const s of NOVA_DEFAULT_SUGGESTIONS) add(s);
  return out.slice(0, 3);
}
/**
 * One chat turn. The user message must already be in the user's history
 * (callers append it first, so a retry/regenerate keeps it). Tries the LLM
 * when a key is set, falls back to the local keyword answers on ANY failure.
 * stream:true → SSE deltas + final done event; else JSON. Never throws after
 * SSE headers are sent.
 */
async function handleChatTurn(res, user, message, stream) {
  const history = getNovaChat(user.id).messages;
  const messages = [{ role: 'system', content: nova.CHAT_SYS },
    ...history.map(m => ({ role: m.role, content: m.content }))];
  if (process.env.OPENAI_API_KEY) {
    try {
      if (stream) {
        res.writeHead(200, { 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-cache', 'Connection': 'keep-alive', 'X-Accel-Buffering': 'no', 'X-Content-Type-Options': 'nosniff', 'X-Frame-Options': 'DENY', 'Referrer-Policy': 'no-referrer' });
        let full = '';
        try {
          full = await nova.chatCompleteMessages(messages, { maxTokens: 800, onToken: d => { full += d; try { res.write(`data: ${JSON.stringify({ delta: d })}\n\n`); } catch {} } });
        } catch {
          try { res.write(`data: ${JSON.stringify({ error: 'Nova could not finish that reply. Try again.' })}\n\n`); } catch {}
          try { res.end(); } catch {}
          return;
        }
        appendNovaChat(user.id, 'assistant', full);
        await persist().catch(() => {});
        try {
          res.write(`data: ${JSON.stringify({ done: true, reply: full, provider: 'openai', screen: null, suggestions: novaSuggestions(full) })}\n\n`);
          res.end();
        } catch {}
        return;
      }
      const reply = await nova.chatCompleteMessages(messages, { maxTokens: 800 });
      appendNovaChat(user.id, 'assistant', reply);
      await persist().catch(() => {});
      send(res, 200, { reply, screen: null, suggestions: novaSuggestions(reply), provider: 'openai' });
      return;
    } catch { /* fall through to local */ }
  }
  const out = novaReply(user, message);
  appendNovaChat(user.id, 'assistant', out.reply);
  await persist().catch(() => {});
  send(res, 200, { ...out, provider: 'local' });
}

  if (req.method === 'POST' && url.pathname === '/api/chat') return readBody(req).then(async body=>{
    if(!req.auth) return send(res,401,{error:'Sign in required'});
    if(!consumeRate(chatAttempts, req.auth.id, 30, 60*1000)) return send(res,429,{error:'Too many messages. Wait a minute and try again.'});
    const message=String(body.message||'').trim(); if(!message||message.length>2000) return send(res,400,{error:'Write a message (up to 2,000 characters).'});
    const user=store.users.find(u=>u.id===req.auth.id); if(!user) return send(res,401,{error:'Sign in required'});
    appendNovaChat(user.id,'user',message);
    await persist().catch(()=>{});
    await handleChatTurn(res, user, message, body.stream===true);
  }).catch(e=>{ if(res.headersSent){ try{res.end();}catch{} return; } send(res,400,{error:e.message}); });

  if (req.method === 'GET' && url.pathname === '/api/chat/history') {
    if(!req.auth) return send(res,401,{error:'Sign in required'});
    const chat=getNovaChat(req.auth.id);
    return send(res,200,{messages:chat.messages.slice(-NOVA_CHAT_MAX),provider:nova.provider()});
  }

  if (req.method === 'POST' && url.pathname === '/api/chat/clear') return readBody(req).then(async ()=>{
    if(!req.auth) return send(res,401,{error:'Sign in required'});
    store.novaChats ||= {}; delete store.novaChats[req.auth.id];
    await persist();
    return send(res,200,{cleared:true});
  }).catch(e=>send(res,400,{error:e.message}));

  if (req.method === 'POST' && url.pathname === '/api/chat/regenerate') return readBody(req).then(async body=>{
    if(!req.auth) return send(res,401,{error:'Sign in required'});
    if(!consumeRate(chatAttempts, req.auth.id, 30, 60*1000)) return send(res,429,{error:'Too many messages. Wait a minute and try again.'});
    const user=store.users.find(u=>u.id===req.auth.id); if(!user) return send(res,401,{error:'Sign in required'});
    const chat=getNovaChat(user.id);
    if(chat.messages.length && chat.messages[chat.messages.length-1].role==='assistant') chat.messages.pop();
    const lastUser=[...chat.messages].reverse().find(m=>m.role==='user');
    if(!lastUser) return send(res,400,{error:'Nothing to regenerate yet.'});
    await persist().catch(()=>{});
    await handleChatTurn(res, user, lastUser.content, body.stream===true);
  }).catch(e=>{ if(res.headersSent){ try{res.end();}catch{} return; } send(res,400,{error:e.message}); });

  // ---- Nova AI tools (OpenAI when OPENAI_API_KEY is set, local built-ins otherwise) ----
  if (req.method === 'POST' && url.pathname === '/api/nova') return readBody(req).then(async body=>{
    if(!consumeRate(novaAttempts, req.auth.id, 30, 60*1000)) return send(res,429,{error:'Too many Nova requests. Wait a minute and try again.'});
    const toolName=String(body.tool||'').trim();
    const tool=nova.tools[toolName];
    if(!tool) return send(res,400,{error:'Unknown Nova tool. Choose: '+Object.keys(nova.tools).join(', ')+'.'});
    if(req.auth.role==='student'&&toolName==='teacher') return send(res,403,{error:'The teacher assistant is for teachers.'});
    try{
      const out=await tool.run({user:req.auth,store},body.input||{});
      send(res,200,{tool:toolName,provider:out.provider,result:out.result});
    }catch(err){ send(res,400,{error:err.message||'Nova could not complete that.'}); }
  }).catch(e=>send(res,400,{error:e.message}));
  if (req.method === 'GET' && url.pathname === '/api/nova/tools') return send(res,200,{tools:Object.entries(nova.tools).map(([id,t])=>({id,desc:t.desc})),provider:nova.provider()});

  // ---- AI Quiz Generator (upload notes -> generate MCQs -> save as a real quiz) ----
  if (req.method === 'POST' && url.pathname === '/api/quizgen/upload') return readBody(req, { maxBytes: MAX_UPLOAD_BODY }).then(async body=>{
    const filename=String(body.filename||'notes.txt').slice(0,120);
    const data=String(body.data||'');
    if(!data) return send(res,400,{error:'Upload a notes file (TXT, Markdown, or PDF).'});
    let buffer;
    try{ buffer=Buffer.from(data,'base64'); }catch{ return send(res,400,{error:'File data must be base64.'}); }
    if(!buffer.length||buffer.length>quizgen.MAX_UPLOAD_BYTES) return send(res,400,{error:'File must be under 5MB.'});
    const out=quizgen.extractText(buffer, body.mimeType, filename);
    if(!out.ok) return send(res,400,{error:out.error});
    const text=out.text.slice(0, quizgen.MAX_TEXT_CHARS);
    if(!text.trim()) return send(res,400,{error:'No readable text found in this file. Scanned/image PDFs have no text layer to read.'});
    return send(res,200,{text, charCount:text.length, filename, kind:out.kind});
  }).catch(e=>send(res,400,{error:e.message}));
  if (req.method === 'POST' && url.pathname === '/api/quizgen/generate') return readBody(req).then(async body=>{
    if(!consumeRate(novaAttempts, req.auth.id, 30, 60*1000)) return send(res,429,{error:'Too many Nova requests. Wait a minute and try again.'});
    const text=String(body.text||'').trim();
    if(!text) return send(res,400,{error:'Provide notes text to generate from.'});
    if(text.length>12000) return send(res,400,{error:'Notes text is too long (12,000 characters max for generation).'});
    const count=Math.max(1,Math.min(10,Math.floor(Number(body.count)||5)));
    try{
      const out=await nova.tools.quizgen.run({user:req.auth,store},{text,count});
      const questions=quizgen.normalizeGeneratedQuestions((out.result&&out.result.questions)||[]).map(quizgen.publicGeneratedQuestion);
      if(!questions.length) return send(res,400,{error:'No usable questions could be generated from these notes. Try longer notes.'});
      return send(res,200,{questions,provider:out.provider});
    }catch(err){ return send(res,400,{error:err.message||'Nova could not generate questions.'}); }
  }).catch(e=>send(res,400,{error:e.message}));
  if (req.method === 'POST' && url.pathname === '/api/quizgen/save') return readBody(req).then(async body=>{
    if(!['teacher','admin'].includes(req.auth.role)) return send(res,403,{error:'Only teachers can save generated quizzes to the shared bank.'});
    const title=String(body.title||'').trim();
    if(title.length<3||title.length>120) return send(res,400,{error:'Quiz title must be 3 to 120 characters.'});
    const normalized=quizgen.normalizeGeneratedQuestions(body.questions||[]);
    if(!normalized.length) return send(res,400,{error:'Add at least one valid question (4 options, one correct answer).'});
    const qErr=validateQuizQuestions(normalized); if(qErr) return send(res,400,{error:qErr});
    let courseId=null;
    if(body.courseId){const c=(store.courses||[]).find(x=>x.id===body.courseId);if(!c)return send(res,404,{error:'Course not found.'});if(req.auth.role!=='admin'&&c.ownerId!==req.auth.id)return send(res,403,{error:'Choose one of your own courses.'});courseId=c.id;}
    const status=body.status==='draft'?'draft':'published';
    const quiz=Object.assign({id:randomUUID(),courseId,ownerId:req.auth.id,title,description:'Generated with the Nova Quiz Generator.',timeLimitMin:0,maxAttempts:0,shuffleQuestions:false,shuffleOptions:false,passingScore:50,status,isFinalAssessment:false,questions:normalized.map(normalizeQuestion),createdAt:new Date().toISOString(),updatedAt:new Date().toISOString(),generatedFrom:'quizgen'},defaultQuizConfig());
    store.quizzes.unshift(quiz);
    store.quizgenHistory.unshift({id:randomUUID(),userId:req.auth.id,title,quizId:quiz.id,courseId,questionCount:normalized.length,provider:body.provider||'local',kind:'quiz',createdAt:new Date().toISOString()});
    await persist(); search.scheduleRebuild();
    return send(res,201,{quiz});
  }).catch(e=>send(res,400,{error:e.message}));
  if (req.method === 'POST' && url.pathname === '/api/quizgen/save-practice') return readBody(req).then(async body=>{
    if(req.auth.role!=='student') return send(res,403,{error:'Practice quizzes are for students.'});
    const title=String(body.title||'Practice quiz').trim().slice(0,120)||'Practice quiz';
    const normalized=quizgen.normalizeGeneratedQuestions(body.questions||[]);
    if(!normalized.length) return send(res,400,{error:'Add at least one valid question (4 options, one correct answer).'});
    const qErr=validateQuizQuestions(normalized); if(qErr) return send(res,400,{error:qErr});
    const quiz=Object.assign({id:randomUUID(),courseId:null,ownerId:req.auth.id,title,description:'Personal practice quiz generated from your notes.',timeLimitMin:0,maxAttempts:0,shuffleQuestions:false,shuffleOptions:false,passingScore:50,status:'published',isFinalAssessment:false,practice:true,questions:normalized.map(normalizeQuestion),createdAt:new Date().toISOString(),updatedAt:new Date().toISOString(),generatedFrom:'quizgen'},defaultQuizConfig());
    store.quizzes.unshift(quiz);
    store.quizgenHistory.unshift({id:randomUUID(),userId:req.auth.id,title,quizId:quiz.id,courseId:null,questionCount:normalized.length,provider:body.provider||'local',kind:'practice',createdAt:new Date().toISOString()});
    await persist();
    return send(res,201,{quiz});
  }).catch(e=>send(res,400,{error:e.message}));
  if (req.method === 'GET' && url.pathname === '/api/quizgen/history') {
    const all=(store.quizgenHistory||[]);
    const list=req.auth.role==='admin'?all:all.filter(h=>h.userId===req.auth.id);
    return send(res,200,{history:list.slice(0,50)});
  }

  // ---- Family (Slice 1): parent portal + announcements ----
  const needFamilyPerm = () => { if (!org.can(req.auth, 'family.manage')) { send(res, 403, { error: 'Family management is not permitted for your role.' }); return false; } return true; };
  const familyInstOk = (institutionId) => { const s = org.orgScope(req.auth); if (s.institutionId && s.institutionId !== institutionId) { send(res, 403, { error: 'This belongs to another institution.' }); return false; } return true; };

  // ----- Parent links (admin) -----
  if (req.method === 'POST' && url.pathname === '/api/admin/parent-links') return readBody(req).then(async body => {
    if (!needFamilyPerm()) return;
    const parent = (store.users || []).find(u => u.id === body.parentId);
    const student = (store.users || []).find(u => u.id === body.studentId);
    if (!parent || parent.role !== 'parent' || parent.status !== 'active') return send(res, 400, { error: 'Choose an active parent account.' });
    if (!student || student.role !== 'student' || student.status !== 'active') return send(res, 400, { error: 'Choose an active student account.' });
    const relation = String(body.relation || 'guardian').toLowerCase();
    if (!family.RELATIONS.includes(relation)) return send(res, 400, { error: 'Relation must be one of: ' + family.RELATIONS.join(', ') + '.' });
    if (!familyInstOk(student.institutionId || null) || !familyInstOk(parent.institutionId || null)) return;
    if (org.orgScope(req.auth).institutionId && parent.institutionId !== student.institutionId) return send(res, 403, { error: 'Parent and student must belong to the same institution.' });
    if ((store.parentLinks || []).some(l => l.parentId === parent.id && l.studentId === student.id)) return send(res, 409, { error: 'This parent is already linked to this student.' });
    const link = { id: randomUUID(), parentId: parent.id, studentId: student.id, relation, createdAt: new Date().toISOString() };
    store.parentLinks.unshift(link);
    audit(req.auth, 'linked parent', `${parent.name} -> ${student.name}`);
    await persist(); send(res, 201, { link });
  }).catch(e => send(res, 400, { error: e.message }));
  if (req.method === 'GET' && url.pathname === '/api/admin/parent-links') {
    if (!needFamilyPerm()) return;
    const s = org.orgScope(req.auth);
    const qParent = url.searchParams.get('parentId'), qStudent = url.searchParams.get('studentId');
    const list = (store.parentLinks || []).filter(l => {
      if (qParent && l.parentId !== qParent) return false;
      if (qStudent && l.studentId !== qStudent) return false;
      if (s.institutionId) {
        const st = (store.users || []).find(u => u.id === l.studentId);
        if (!st || st.institutionId !== s.institutionId) return false;
      }
      return true;
    }).map(l => {
      const p = (store.users || []).find(u => u.id === l.parentId), st = (store.users || []).find(u => u.id === l.studentId);
      return { ...l, parentName: p ? p.name : '', studentName: st ? st.name : '' };
    });
    return send(res, 200, { parentLinks: list });
  }
  if (req.method === 'DELETE' && /^\/api\/admin\/parent-links\/[^/]+$/.test(url.pathname)) {
    if (!needFamilyPerm()) return;
    const id = url.pathname.split('/').pop();
    const idx = (store.parentLinks || []).findIndex(l => l.id === id);
    if (idx < 0) return send(res, 404, { error: 'Parent link not found.' });
    const link = store.parentLinks[idx];
    const st = (store.users || []).find(u => u.id === link.studentId);
    if (!familyInstOk(st ? (st.institutionId || null) : null)) return;
    store.parentLinks.splice(idx, 1);
    audit(req.auth, 'unlinked parent', link.id);
    return persist().then(() => send(res, 200, { deleted: true }));
  }

  // ----- Student link code -----
  if (req.method === 'GET' && url.pathname === '/api/student/link-code') {
    if (req.auth.role !== 'student') return send(res, 403, { error: 'Student access required.' });
    let entry = (store.studentLinkCodes || []).find(c => c.studentId === req.auth.id);
    if (!entry) {
      entry = { studentId: req.auth.id, code: family.genLinkCode(), createdAt: new Date().toISOString() };
      while ((store.studentLinkCodes || []).some(c => c.code === entry.code)) entry.code = family.genLinkCode();
      store.studentLinkCodes.push(entry);
      await persist();
    }
    return send(res, 200, { code: entry.code });
  }
  if (req.method === 'POST' && url.pathname === '/api/student/link-code/regenerate') {
    if (req.auth.role !== 'student') return send(res, 403, { error: 'Student access required.' });
    let entry = (store.studentLinkCodes || []).find(c => c.studentId === req.auth.id);
    if (!entry) { entry = { studentId: req.auth.id, code: '', createdAt: new Date().toISOString() }; store.studentLinkCodes.push(entry); }
    entry.code = family.genLinkCode();
    while ((store.studentLinkCodes || []).some(c => c !== entry && c.code === entry.code)) entry.code = family.genLinkCode();
    entry.createdAt = new Date().toISOString();
    await persist();
    return send(res, 200, { code: entry.code });
  }

  // ----- Parent self-link via code -----
  if (req.method === 'POST' && url.pathname === '/api/parent/link') return readBody(req).then(async body => {
    if (req.auth.role !== 'parent') return send(res, 403, { error: 'Parent access required.' });
    const code = String(body.code || '').trim().toUpperCase();
    if (!/^[A-Z0-9]{8}$/.test(code)) return send(res, 400, { error: 'Enter the 8-character link code from the student.' });
    const entry = (store.studentLinkCodes || []).find(c => c.code === code);
    if (!entry) return send(res, 404, { error: 'This link code was not recognized.' });
    const student = (store.users || []).find(u => u.id === entry.studentId && u.role === 'student' && u.status === 'active');
    if (!student) return send(res, 404, { error: 'This link code is no longer valid.' });
    if ((store.parentLinks || []).some(l => l.parentId === req.auth.id && l.studentId === student.id)) return send(res, 409, { error: 'You are already linked to this student.' });
    const link = { id: randomUUID(), parentId: req.auth.id, studentId: student.id, relation: 'guardian', createdAt: new Date().toISOString() };
    store.parentLinks.unshift(link);
    const me = (store.users || []).find(u => u.id === req.auth.id);
    const isFirstLink = !(store.parentLinks || []).some(l => l.parentId === req.auth.id && l.id !== link.id);
    if (me && isFirstLink && student.institutionId && me.institutionId !== student.institutionId) me.institutionId = student.institutionId;
    audit(req.auth, 'self-linked parent', student.name);
    await persist(); send(res, 201, { link, student: publicUser(student) });
  }).catch(e => send(res, 400, { error: e.message }));

  // ----- Parent children -----
  const requireParent = () => { if (req.auth.role !== 'parent') { send(res, 403, { error: 'Parent access required.' }); return false; } return true; };
  if (req.method === 'GET' && url.pathname === '/api/parent/children') {
    if (!requireParent()) return;
    const out = (store.parentLinks || []).filter(l => l.parentId === req.auth.id).map(l => {
      const student = (store.users || []).find(u => u.id === l.studentId && u.role === 'student');
      if (!student) return null;
      return { student: publicUser(student), relation: l.relation, progress: family.childProgress(student.id), attendance: family.childAttendance(student.id) };
    }).filter(Boolean);
    return send(res, 200, { children: out });
  }
  if (req.method === 'GET' && /^\/api\/parent\/children\/[^/]+\/results$/.test(url.pathname)) {
    if (!requireParent()) return;
    const studentId = url.pathname.split('/')[4];
    const linked = (store.parentLinks || []).some(l => l.parentId === req.auth.id && l.studentId === studentId);
    if (!linked) return send(res, 403, { error: 'This student is not linked to your account.' });
    return send(res, 200, { results: family.childResults(studentId), certificates: family.childCertificates(studentId) });
  }
  if (req.method === 'GET' && url.pathname === '/api/parent/announcements') {
    if (!requireParent()) return;
    const s = org.orgScope(req.auth);
    const list = (store.announcements || []).filter(a =>
      ['all', 'parents'].includes(a.audience) && (!s.institutionId || !a.institutionId || a.institutionId === s.institutionId)
    ).sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')));
    return send(res, 200, { announcements: list });
  }

  // ----- Announcements (admin) -----
  const AUDIENCES = ['all', 'students', 'parents', 'teachers'];
  if (req.method === 'POST' && url.pathname === '/api/admin/announcements') return readBody(req).then(async body => {
    if (!needFamilyPerm()) return;
    const title = String(body.title || '').trim(), annBody = String(body.body || '').trim();
    const audience = String(body.audience || 'all').toLowerCase();
    if (title.length < 2 || title.length > 200) return send(res, 400, { error: 'Title must be 2 to 200 characters.' });
    if (annBody.length < 2 || annBody.length > 5000) return send(res, 400, { error: 'Body must be 2 to 5,000 characters.' });
    if (!AUDIENCES.includes(audience)) return send(res, 400, { error: 'Audience must be one of: ' + AUDIENCES.join(', ') + '.' });
    const s = org.orgScope(req.auth);
    const institutionId = s.institutionId || body.institutionId || (store.institutions[0] || {}).id || null;
    if (body.institutionId && !familyInstOk(body.institutionId)) return;
    const ann = { id: randomUUID(), institutionId, title, body: annBody, audience, authorId: req.auth.id, createdAt: new Date().toISOString() };
    store.announcements.unshift(ann);
    for(const recipient of store.users||[]){const audienceMatch=audience==='all'||recipient.role===audience;if(recipient.status==='active'&&audienceMatch&&(!institutionId||!recipient.institutionId||recipient.institutionId===institutionId))createNotification(recipient.id,'institution-announcement',title,annBody,ann.id);}
    audit(req.auth, 'created announcement', title);
    await persist(); send(res, 201, { announcement: ann });
  }).catch(e => send(res, 400, { error: e.message }));
  if (req.method === 'GET' && url.pathname === '/api/admin/announcements') {
    if (!needFamilyPerm()) return;
    const s = org.orgScope(req.auth);
    const list = (store.announcements || []).filter(a => !s.institutionId || !a.institutionId || a.institutionId === s.institutionId)
      .sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')));
    return send(res, 200, { announcements: list });
  }
  if ((req.method === 'PATCH' || req.method === 'DELETE') && /^\/api\/admin\/announcements\/[^/]+$/.test(url.pathname)) return readBody(req).then(async body => {
    if (!needFamilyPerm()) return;
    const id = url.pathname.split('/').pop();
    const ann = (store.announcements || []).find(a => a.id === id);
    if (!ann) return send(res, 404, { error: 'Announcement not found.' });
    if (!familyInstOk(ann.institutionId || null)) return;
    if (req.method === 'DELETE') {
      store.announcements = (store.announcements || []).filter(a => a.id !== id);
      audit(req.auth, 'deleted announcement', ann.title);
      await persist(); return send(res, 200, { deleted: true });
    }
    if (body.title !== undefined) { const t = String(body.title).trim(); if (t.length < 2 || t.length > 200) return send(res, 400, { error: 'Title must be 2 to 200 characters.' }); ann.title = t; }
    if (body.body !== undefined) { const b = String(body.body).trim(); if (b.length < 2 || b.length > 5000) return send(res, 400, { error: 'Body must be 2 to 5,000 characters.' }); ann.body = b; }
    if (body.audience !== undefined) { const a = String(body.audience).toLowerCase(); if (!AUDIENCES.includes(a)) return send(res, 400, { error: 'Audience must be one of: ' + AUDIENCES.join(', ') + '.' }); ann.audience = a; }
    audit(req.auth, 'updated announcement', ann.title);
    await persist(); send(res, 200, { announcement: ann });
  }).catch(e => send(res, 400, { error: e.message }));

  // ----- Announcements feed for students/teachers (role-filtered) -----
  if (req.method === 'GET' && url.pathname === '/api/announcements') {
    const role = req.auth.role;
    const allowed = role === 'student' ? ['all', 'students'] : role === 'teacher' ? ['all', 'teachers'] : ['all', 'students', 'parents', 'teachers'];
    const s = org.orgScope(req.auth);
    const list = (store.announcements || []).filter(a =>
      allowed.includes(a.audience) && (!s.institutionId || !a.institutionId || a.institutionId === s.institutionId)
    ).sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')));
    return send(res, 200, { announcements: list });
  }

  // ----- Library + offline learning (Slice 2) -----

  // ----- Catalog (admin) -----
  if (req.method === 'GET' && url.pathname === '/api/admin/library') {
    if (!needLibraryPerm()) return;
    const sc = org.orgScope(req.auth);
    const kind = String(url.searchParams.get('kind') || '').toLowerCase();
    const q = String(url.searchParams.get('q') || '').trim().toLowerCase();
    const list = (store.libraryItems || []).filter(i =>
      (!sc.institutionId || !i.institutionId || i.institutionId === sc.institutionId) &&
      (!kind || i.kind === kind) &&
      (!q || `${i.title} ${i.author} ${i.isbn} ${i.subject}`.toLowerCase().includes(q))
    ).sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')));
    return send(res, 200, { items: list.map(library.publicItem) });
  }
  if (req.method === 'GET' && url.pathname === '/api/admin/library/loans') {
    if (!needLibraryPerm()) return;
    const sc = org.orgScope(req.auth);
    const loans = (store.bookLoans || []).filter(l => {
      const item = (store.libraryItems || []).find(i => i.id === l.itemId);
      return !sc.institutionId || !item || !item.institutionId || item.institutionId === sc.institutionId;
    }).sort((a, b) => String(b.borrowedAt || '').localeCompare(String(a.borrowedAt || '')));
    return send(res, 200, { loans: loans.map(l => {
      const base = library.publicLoan(l);
      const item = (store.libraryItems || []).find(i => i.id === l.itemId) || {};
      const student = store.users.find(u => u.id === l.studentId) || {};
      return { ...base, title: item.title || base.itemTitle, studentName: student.name || l.studentId };
    }) });
  }
  if (req.method === 'POST' && url.pathname === '/api/admin/library') return readBody(req).then(async body => {
    if (!libraryAdminOnly()) return;
    if (!needLibraryPerm()) return;
    const v = library.validateItem(body, null);
    if (!v.ok) return send(res, 400, { error: v.error });
    const sc = org.orgScope(req.auth);
    let institutionId = sc.institutionId;
    if (!institutionId) {
      if (body.institutionId && !(store.institutions || []).some(i => i.id === body.institutionId))
        return send(res, 400, { error: 'Choose an existing institution.' });
      institutionId = body.institutionId || (store.institutions[0] || {}).id || null;
    }
    const item = { id: randomUUID(), institutionId, ...v.value, totalCopies: v.value.kind === 'book' ? v.value.totalCopies : 0, createdAt: new Date().toISOString() };
    store.libraryItems.unshift(item);
    audit(req.auth, 'added library item', item.title);
    await persist(); send(res, 201, { item: library.publicItem(item) });
  }).catch(e => send(res, 400, { error: e.message }));
  if (req.method === 'PATCH' && /^\/api\/admin\/library\/[^/]+$/.test(url.pathname)) return readBody(req).then(async body => {
    if (!libraryAdminOnly()) return;
    if (!needLibraryPerm()) return;
    const id = url.pathname.split('/').pop();
    const item = (store.libraryItems || []).find(i => i.id === id);
    if (!item) return send(res, 404, { error: 'Library item not found.' });
    if (!libraryInstOk(item.institutionId)) return;
    const v = library.validateItem(body, item);
    if (!v.ok) return send(res, 400, { error: v.error });
    Object.assign(item, v.value);
    item.totalCopies = item.kind === 'book' ? v.value.totalCopies : 0;
    audit(req.auth, 'updated library item', item.title);
    await persist(); send(res, 200, { item: library.publicItem(item) });
  }).catch(e => send(res, 400, { error: e.message }));
  if (req.method === 'DELETE' && /^\/api\/admin\/library\/[^/]+$/.test(url.pathname)) return readBody(req).then(async () => {
    if (!libraryAdminOnly()) return;
    if (!needLibraryPerm()) return;
    const id = url.pathname.split('/').pop();
    const item = (store.libraryItems || []).find(i => i.id === id);
    if (!item) return send(res, 404, { error: 'Library item not found.' });
    if (!libraryInstOk(item.institutionId)) return;
    if ((store.bookLoans || []).some(l => l.itemId === id && !l.returnedAt))
      return send(res, 409, { error: 'Cannot delete: copies are currently on loan.' });
    store.libraryItems = (store.libraryItems || []).filter(i => i.id !== id);
    for (const rl of store.readingLists || []) rl.itemIds = (rl.itemIds || []).filter(x => x !== id);
    audit(req.auth, 'deleted library item', item.title);
    await persist(); send(res, 200, { deleted: true });
  }).catch(e => send(res, 400, { error: e.message }));
  if (req.method === 'GET' && url.pathname === '/api/library/stats') {
    if (!libraryAdminOnly()) return;
    const sc = org.orgScope(req.auth);
    const items = (store.libraryItems || []).filter(i => !sc.institutionId || !i.institutionId || i.institutionId === sc.institutionId);
    const itemIds = new Set(items.map(i => i.id));
    const loans = (store.bookLoans || []).filter(l => itemIds.has(l.itemId));
    const active = loans.filter(l => !l.returnedAt);
    return send(res, 200, {
      totals: {
        books: items.filter(i => i.kind === 'book').length,
        ebooks: items.filter(i => i.kind === 'ebook').length,
        journals: items.filter(i => i.kind === 'journal').length,
        totalCopies: items.filter(i => i.kind === 'book').reduce((n, i) => n + (i.totalCopies || 0), 0),
      },
      loans: { active: active.length, overdue: active.filter(library.isOverdue).length, returned: loans.filter(l => l.returnedAt).length, total: loans.length },
    });
  }

  // ----- Browse (students/teachers/parents) -----
  if (req.method === 'GET' && url.pathname === '/api/library') {
    const sc = org.orgScope(req.auth);
    const kind = String(url.searchParams.get('kind') || '').toLowerCase();
    const subject = String(url.searchParams.get('subject') || '').trim().toLowerCase();
    const q = String(url.searchParams.get('q') || '').trim().toLowerCase();
    const list = (store.libraryItems || []).filter(i =>
      (!sc.institutionId || !i.institutionId || i.institutionId === sc.institutionId) &&
      (!kind || i.kind === kind) &&
      (!subject || String(i.subject || '').toLowerCase() === subject) &&
      (!q || `${i.title} ${i.author} ${i.isbn} ${i.subject}`.toLowerCase().includes(q))
    ).sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')));
    return send(res, 200, { items: list.map(library.publicItem) });
  }

  // ----- Borrow / return / my loans (students) -----
  if (req.method === 'POST' && /^\/api\/library\/[^/]+\/borrow$/.test(url.pathname)) return readBody(req).then(async () => {
    if (req.auth.role !== 'student') return send(res, 403, { error: 'Only students can borrow books.' });
    const id = url.pathname.split('/')[3];
    const item = (store.libraryItems || []).find(i => i.id === id);
    if (!item) return send(res, 404, { error: 'Library item not found.' });
    if (!libraryInstOk(item.institutionId)) return;
    if (item.kind !== 'book') return send(res, 400, { error: 'Only physical books can be borrowed; e-books and journals are read online.' });
    if ((store.bookLoans || []).some(l => l.itemId === id && l.studentId === req.auth.id && !l.returnedAt))
      return send(res, 409, { error: 'You already have this book on loan.' });
    const activeCount = (store.bookLoans || []).filter(l => l.itemId === id && !l.returnedAt).length;
    if (activeCount >= (item.totalCopies || 0)) return send(res, 409, { error: 'No copies are currently available.' });
    const now = new Date();
    const loan = { id: randomUUID(), itemId: id, studentId: req.auth.id, borrowedAt: now.toISOString(), dueAt: new Date(now.getTime() + library.LOAN_DAYS * 86400000).toISOString(), returnedAt: null };
    store.bookLoans.unshift(loan);
    await persist(); send(res, 201, { loan: library.publicLoan(loan) });
  }).catch(e => send(res, 400, { error: e.message }));
  if (req.method === 'GET' && url.pathname === '/api/library/loans/mine') {
    if (req.auth.role !== 'student') return send(res, 403, { error: 'Student access required.' });
    const loans = (store.bookLoans || []).filter(l => l.studentId === req.auth.id)
      .sort((a, b) => String(b.borrowedAt || '').localeCompare(String(a.borrowedAt || '')));
    return send(res, 200, { loans: loans.map(library.publicLoan) });
  }
  if (req.method === 'POST' && /^\/api\/library\/loans\/[^/]+\/return$/.test(url.pathname)) return readBody(req).then(async () => {
    const id = url.pathname.split('/')[4];
    const loan = (store.bookLoans || []).find(l => l.id === id);
    if (!loan) return send(res, 404, { error: 'Loan not found.' });
    if (loan.studentId !== req.auth.id && !org.isAdminRole(req.auth.role))
      return send(res, 403, { error: 'This loan belongs to another student.' });
    if (loan.returnedAt) return send(res, 409, { error: 'This loan was already returned.' });
    loan.returnedAt = new Date().toISOString();
    await persist(); send(res, 200, { loan: library.publicLoan(loan) });
  }).catch(e => send(res, 400, { error: e.message }));

  // ----- Reading lists -----



  if (req.method === 'GET' && url.pathname === '/api/reading-lists') {
    const sc = org.orgScope(req.auth);
    const enrolledIds = new Set((store.enrollments || []).filter(e => e.studentId === req.auth.id).map(e => e.courseId));
    const list = (store.readingLists || []).filter(rl =>
      (!sc.institutionId || !rl.institutionId || rl.institutionId === sc.institutionId) &&
      (!rl.courseId || enrolledIds.has(rl.courseId))
    ).sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')));
    return send(res, 200, { readingLists: list.map(populateReadingList) });
  }

  // ----- Offline sync (students) -----
  if (req.method === 'POST' && url.pathname === '/api/offline/sync') return readBody(req).then(async body => {
    if (req.auth.role !== 'student') return send(res, 403, { error: 'Student access required.' });
    const progress = Array.isArray(body.progress) ? body.progress.slice(0, 500) : [];
    const downloads = Array.isArray(body.downloads) ? [...new Set(body.downloads.map(String))].slice(0, 500) : [];
    let applied = 0, downloadsRecorded = 0;
    const conflicts = [];
    for (const p of progress) {
      const lessonId = String((p && p.lessonId) || '').slice(0, 100);
      if (!lessonId) { conflicts.push({ lessonId: '', reason: 'Missing lessonId.' }); continue; }
      const course = library.findLessonCourse(lessonId);
      if (!course) { conflicts.push({ lessonId, reason: 'Lesson not found.' }); continue; }
      const pos = Math.floor(Number(p.positionSec) || 0);
      if (pos > 0) store.lessonPositions[`${req.auth.id}:${lessonId}`] = { positionSec: pos, updatedAt: new Date().toISOString() };
      if (p.completed) {
        const key = `${req.auth.id}:${course.id}`;
        store.courseLessonProgress[key] ||= [];
        if (!store.courseLessonProgress[key].includes(lessonId)) {
          store.courseLessonProgress[key].push(lessonId);
          awardXp(req.auth.id, 10, 'lesson-complete');
          awardBadge(req.auth.id, 'first-steps');
        }
      }
      applied++;
    }
    for (const lessonId of downloads) {
      if (!library.findLessonCourse(lessonId)) { conflicts.push({ lessonId, reason: 'Lesson not found.' }); continue; }
      if (!(store.lessonDownloads || []).some(d => d.studentId === req.auth.id && d.lessonId === lessonId)) {
        store.lessonDownloads.push({ id: randomUUID(), studentId: req.auth.id, lessonId, downloadedAt: new Date().toISOString() });
        downloadsRecorded++;
      }
    }
    await persist();
    send(res, 200, { applied, downloadsRecorded, conflicts });
  }).catch(e => send(res, 400, { error: e.message }));

  if (req.method === 'POST' && url.pathname === '/api/auth/setup-admin') return readBody(req).then(async body=>{
    if(!consumeRate(setupAttempts, req.socket.remoteAddress||'local', 5, 60*60*1000)) return send(res,429,{error:'Too many setup attempts. Try again later.'});
    if(store.users.some(u=>u.role==='admin')) return send(res,403,{error:'An administrator account already exists. Ask an existing administrator to create your account.'});
    const name=String(body.name||'').trim(),username=String(body.username||'').trim().toLowerCase(),password=String(body.password||'');
    if(name.length<2||name.length>80||!/^[a-z0-9][a-z0-9._-]{2,29}$/.test(username)||password.length<12) return send(res,400,{error:'Enter a name, valid username, and 12+ character password.'});
    if(body.otpVerified!==true||!/^\d{4,8}$/.test(String(body.otpCode||'')))return send(res,400,{error:'Administrator setup requires a verified demo OTP.'});
    const configuredCode=String(process.env.EDUVERSE_ADMIN_SETUP_CODE||'');
    if(process.env.NODE_ENV==='production'&&configuredCode.length<32)return send(res,503,{error:'First administrator setup requires EDUVERSE_ADMIN_SETUP_CODE to be configured with at least 32 characters.'});
    const expectedCode=configuredCode||'123456';
    if(String(body.setupCode||'')!==expectedCode)return send(res,403,{error:'The administrator setup code is incorrect.'});
    if(!body.termsAccepted) return send(res,400,{error:'Accept the Terms and Privacy Policy to create an account.'});
    if(store.users.some(u=>(u.username||'').toLowerCase()===username)) return send(res,409,{error:'That username is already in use.'});
    const user={id:randomUUID(),name,username,email:'',phone:'',passwordHash:await passwordHash(password),role:'admin',status:'active',createdAt:new Date().toISOString()};
    store.users.push(user); audit({id:'setup'},'Created first administrator',username); await persist(); send(res,201,{user:publicUser(user)});
  }).catch(e=>send(res,400,{error:e.message}));
  send(res,404,{error:'Route not found'});
}
let appServer;
function stopServices() {
  if (stopping) return;
  stopping = true;
  if (openCvProcess && !openCvProcess.killed) openCvProcess.kill('SIGTERM');
  try { live.shutdown(); } catch {}
  appServer?.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 2000).unref();
}
process.once('SIGINT', stopServices);
process.once('SIGTERM', stopServices);
bootstrapAdmin().then(()=>{
  appServer=http.createServer((req,res)=>{try{Promise.resolve(route(req,res)).catch(()=>send(res,500,{error:'Internal server error'}));}catch{send(res,500,{error:'Internal server error'});}});
  live.init({sessions,store,parseCookies,SESSION_MS});
  appServer.on('upgrade',(req,socket,head)=>{
    try{
      if(!live.handleUpgrade(req,socket,head)){socket.write('HTTP/1.1 404 Not Found\r\nContent-Length: 0\r\n\r\n');socket.destroy();}
    }catch{socket.destroy();}
  });
  appServer.listen(PORT,BIND_HOST,()=>{
    console.log(`EduVerse app and API listening on http://${BIND_HOST}:${PORT}`);
    startOpenCvService().catch(error=>console.warn(`[opencv] Auto-start failed: ${error.message}`));
  });
}).catch(error=>{console.error(error.message);process.exit(1);});
