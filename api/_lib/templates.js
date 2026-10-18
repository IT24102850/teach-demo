/**
 * Outgoing message wording (Appendix B), in English and Tamil.
 * Keep every amount in LKR and always name the teacher.
 */

export const money = (n) => `LKR ${Number(n || 0).toLocaleString('en-US')}`;

const EN = {
  invite: (v) =>
    `Hi, this is ${v.teacher}. Please fill in this short form to join my classes: ${v.link}. It takes one minute.`,
  // Handoff draft 2: sent from the Invite screen to a class that is not yet
  // on Plus. No amounts, as the handoff asks.
  plusInvite: (v) =>
    `Hi! ${v.teacher}'s ${v.class} class now uses Plus. ` +
    `Join to see attendance, marks and class updates: ${v.link}`,
  classReminder: (v) =>
    `Reminder: ${v.student} has ${v.subject} on ${v.day} at ${v.time} at ${v.place}.`,
  // Point 10: the wording the improvement plan asks for - it names the
  // teacher, the class and the time, so the parent knows which class it was.
  absent: (v) =>
    `Hi, this is ${v.teacher || 'your teacher'}. ${v.student} was absent from today's ` +
    `${v.class || `${v.subject} class`}${v.time ? ` (${v.time})` : ''}. ` +
    `Please let me know if there is a problem. Thank you.`,
  fee: (v) =>
    `Hi, this is ${v.teacher}. A gentle reminder that ${v.student}'s fees for ${v.classes} classes (${money(v.amount)}) are pending. You can pay by bank transfer and send me the slip here. Thank you!`,
  /*
   * Handoff draft 1. The same fee reminder, with one line about Plus on the
   * end, for a parent who is not subscribed. The promo carries no amount, as
   * the handoff asks, and it is only ever added to a message the parent was
   * going to get anyway - it is never a reason to message somebody.
   */
  feePlus: (v) =>
    `${EN.fee(v)}\n\n` +
    `\u{1F4F1} Want to see ${v.student}'s attendance, marks and progress every day? ` +
    `Subscribe to Plus: ${v.link}`,
  // Point 9, phase 2: the class was dragged to another slot.
  moved: (v) =>
    `Hi, this is ${v.teacher}. ${v.student}'s ${v.class} has moved from ${v.from} to ${v.to}. ` +
    `Please come at the new time. Thank you.`,
  paid: (v) =>
    `Payment of ${money(v.amount)} received for ${v.student}` +
    `${v.receipt ? ` (receipt ${v.receipt})` : ''}.` +
    `${Number(v.balance) > 0 ? ` Still to pay: ${money(v.balance)}.` : ''} Thank you.`,
  mark: (v) => `${v.student} scored ${v.score}/${v.max} in ${v.test}.`,
  report: (v) =>
    `Hi, here is ${v.student}'s progress: attended ${v.present} of ${v.total} classes (${v.percent} %), average mark ${v.avg} %. Fees pending: ${money(v.amount)}. Please message me if you have questions.`,
  code: (v) => `Welcome to ${v.teacher}'s classes. Your code to open the app is ${v.code}.`,
  timetable: (v) => `Hi, this is ${v.teacher}. Here is this week's timetable:\n${v.lines}`,
  paper: (v) => `Hi, this is ${v.teacher}. Here is the paper "${v.paper}" for ${v.student}: ${v.link}`,
};

const TA = {
  invite: (v) =>
    `வணக்கம், ${v.teacher} பேசுகிறேன். எனது வகுப்புகளில் சேர இந்த சிறிய படிவத்தை நிரப்புங்கள்: ${v.link}. ஒரு நிமிடம் போதும்.`,
  plusInvite: (v) =>
    `வணக்கம்! ${v.teacher} அவர்களின் ${v.class} வகுப்பு இப்போது Plus பயன்படுத்துகிறது. ` +
    `வருகை, மதிப்பெண்கள் மற்றும் வகுப்புத் தகவல்களைப் பார்க்க இணையவும்: ${v.link}`,
  classReminder: (v) =>
    `நினைவூட்டல்: ${v.student} அவர்களுக்கு ${v.day} ${v.time} மணிக்கு ${v.place} இல் ${v.subject} வகுப்பு உள்ளது.`,
  absent: (v) =>
    `வணக்கம், ${v.teacher || ''} பேசுகிறேன். ${v.student} இன்றைய ${v.class || v.subject} வகுப்பிற்கு${v.time ? ` (${v.time})` : ''} வரவில்லை. ஏதேனும் பிரச்சினை இருந்தால் தெரிவிக்கவும். நன்றி.`,
  fee: (v) =>
    `வணக்கம், ${v.teacher} பேசுகிறேன். ${v.student} அவர்களின் ${v.classes} வகுப்புகளுக்கான கட்டணம் (${money(v.amount)}) செலுத்தப்படவில்லை. வங்கி பணப்பரிமாற்றம் செய்து ரசீதை இங்கே அனுப்பலாம். நன்றி!`,
  feePlus: (v) =>
    `${TA.fee(v)}\n\n` +
    `\u{1F4F1} ${v.student} அவர்களின் வருகை, மதிப்பெண்கள், முன்னேற்றம் தினமும் பார்க்க வேண்டுமா? ` +
    `Plus இல் சேருங்கள்: ${v.link}`,
  moved: (v) =>
    `வணக்கம், ${v.teacher} பேசுகிறேன். ${v.student} அவர்களின் ${v.class} வகுப்பு ` +
    `${v.from} இலிருந்து ${v.to} க்கு மாற்றப்பட்டது. ` +
    `புதிய நேரத்திற்கு வரவும். நன்றி.`,
  paid: (v) =>
    `${v.student} அவர்களுக்கான ${money(v.amount)} கட்டணம் கிடைத்தது` +
    `${v.receipt ? ` (${v.receipt})` : ''}.` +
    `${Number(v.balance) > 0 ? ` மிச்சம்: ${money(v.balance)}.` : ''} நன்றி.`,
  mark: (v) => `${v.student} ${v.test} இல் ${v.score}/${v.max} பெற்றுள்ளார்.`,
  report: (v) =>
    `வணக்கம், ${v.student} அவர்களின் முன்னேற்றம்: ${v.total} வகுப்புகளில் ${v.present} வந்துள்ளார் (${v.percent} %), சராசரி மதிப்பெண் ${v.avg} %. செலுத்த வேண்டிய கட்டணம்: ${money(v.amount)}. கேள்விகள் இருந்தால் தெரிவிக்கவும்.`,
  code: (v) => `${v.teacher} அவர்களின் வகுப்புகளுக்கு வருக. செயலியைத் திறக்க உங்கள் குறியீடு ${v.code}.`,
  timetable: (v) => `வணக்கம், ${v.teacher} பேசுகிறேன். இந்த வாரத்தின் நேர அட்டவணை:\n${v.lines}`,
  paper: (v) => `வணக்கம், ${v.teacher} பேசுகிறேன். "${v.paper}" தாள் ${v.student} அவர்களுக்கு: ${v.link}`,
};

/*
 * Sinhala.
 *
 * The app itself is English and Tamil. The invite screen offers a third
 * language because the message goes to a parent who does not have the app
 * yet, and may never read it in either - so only the two outgoing messages
 * are translated here, not the whole dictionary. Anything else asked for in
 * Sinhala falls back to English rather than printing a key.
 */
const SI = {
  plusInvite: (v) =>
    `\u0d86\u0dba\u0dd4\u0db6\u0ddd\u0dc0\u0db1\u0dca! ${v.teacher}\u0d9c\u0dda ${v.class} \u0db4\u0db1\u0dca\u0dad\u0dd2\u0dba \u0daf\u0dd0\u0db1\u0dca Plus \u0db7\u0dcf\u0dc0\u0dd2\u0dad\u0dcf \u0d9a\u0dbb\u0dba\u0dd2. ` +
    `\u0db4\u0dd0\u0db8\u0dd2\u0dab\u0dd3\u0db8, \u0dbd\u0d9a\u0dd4\u0dab\u0dd4 \u0dc3\u0dc4 \u0db4\u0db1\u0dca\u0dad\u0dd2 \u0dad\u0ddc\u0dbb\u0dad\u0dd4\u0dbb\u0dd4 \u0db6\u0dbd\u0db1\u0dca\u0db1 \u0d91\u0d9a\u0dca\u0dc0\u0db1\u0dca\u0db1: ${v.link}`,
  feePlus: (v) =>
    `${EN.fee(v)}\n\n` +
    `\u{1F4F1} ${v.student}\u0d9c\u0dda \u0db4\u0dd0\u0db8\u0dd2\u0dab\u0dd3\u0db8, \u0dbd\u0d9a\u0dd4\u0dab\u0dd4 \u0dc3\u0dc4 \u0db4\u0dca\u200d\u0dbb\u0d9c\u0dad\u0dd2\u0dba \u0daf\u0dd2\u0db1\u0db4\u0dad\u0dcf \u0db6\u0dbd\u0db1\u0dca\u0db1 \u0d94\u0db1\u0dda\u0daf? ` +
    `Plus \u0dc0\u0dcf\u0dbb\u0dca\u0dad\u0dcf\u0dc0\u0d9a\u0dca \u0d9c\u0db1\u0dca\u0db1: ${v.link}`,
};

/** The languages the invite screen offers. */
export const INVITE_LANGS = [
  { code: 'en', label: 'English' },
  { code: 'ta', label: '\u0ba4\u0bae\u0bbf\u0bb4\u0bcd' },
  { code: 'si', label: '\u0dc3\u0dd2\u0d82\u0dc4\u0dbd' },
];

/** Render one template. Falls back to English if a Tamil line is missing. */
export function render(key, values, lang = 'en') {
  const fn =
    (lang === 'ta' && TA[key]) || (lang === 'si' && SI[key]) || EN[key];
  if (!fn) throw new Error(`Unknown message template: ${key}`);
  return fn(values || {});
}

/** The short label stored on the event row and shown in the parent's feed. */
export const FEED = {
  fee: (v) => `Fee reminder: ${v.classes} classes pending (${money(v.amount)})`,
  absent: (v) => `Marked absent for ${v.subject}`,
  class: (v) => `${v.subject} on ${v.day} at ${v.time}`,
  moved: (v) => `${v.class} moved to ${v.to}`,
  paid: (v) =>
    `Payment of ${money(v.amount)} received${v.receipt ? ` · receipt ${v.receipt}` : ''}`,
  reversed: (v) => `A payment of ${money(v.amount)} was undone`,
  report: () => 'Progress report sent',
  mark: (v) => `Scored ${v.score}/${v.max} in ${v.test}`,
  slip: () => 'Bank slip received, waiting for confirmation',
  join: (v) => `Welcome! Your family code is ${v.code}`,
};
