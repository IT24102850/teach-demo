/**
 * Outgoing message wording (Appendix B), in English and Tamil.
 * Keep every amount in LKR and always name the teacher.
 */

export const money = (n) => `LKR ${Number(n || 0).toLocaleString('en-US')}`;

const EN = {
  invite: (v) =>
    `Hi, this is ${v.teacher}. Please fill in this short form to join my classes: ${v.link}. It takes one minute.`,
  classReminder: (v) =>
    `Reminder: ${v.student} has ${v.subject} on ${v.day} at ${v.time} at ${v.place}.`,
  absent: (v) =>
    `${v.student} was marked absent for today's ${v.subject} class. Please let me know if there is a problem.`,
  fee: (v) =>
    `Hi, this is ${v.teacher}. A gentle reminder that ${v.student}'s fees for ${v.classes} classes (${money(v.amount)}) are pending. You can pay by bank transfer and send me the slip here. Thank you!`,
  paid: (v) => `Payment of ${money(v.amount)} received for ${v.student}. Thank you.`,
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
  classReminder: (v) =>
    `நினைவூட்டல்: ${v.student} அவர்களுக்கு ${v.day} ${v.time} மணிக்கு ${v.place} இல் ${v.subject} வகுப்பு உள்ளது.`,
  absent: (v) =>
    `${v.student} இன்றைய ${v.subject} வகுப்பிற்கு வரவில்லை எனக் குறிக்கப்பட்டுள்ளது. ஏதேனும் பிரச்சினை இருந்தால் தெரிவிக்கவும்.`,
  fee: (v) =>
    `வணக்கம், ${v.teacher} பேசுகிறேன். ${v.student} அவர்களின் ${v.classes} வகுப்புகளுக்கான கட்டணம் (${money(v.amount)}) செலுத்தப்படவில்லை. வங்கி பணப்பரிமாற்றம் செய்து ரசீதை இங்கே அனுப்பலாம். நன்றி!`,
  paid: (v) => `${v.student} அவர்களுக்கான ${money(v.amount)} கட்டணம் கிடைத்தது. நன்றி.`,
  mark: (v) => `${v.student} ${v.test} இல் ${v.score}/${v.max} பெற்றுள்ளார்.`,
  report: (v) =>
    `வணக்கம், ${v.student} அவர்களின் முன்னேற்றம்: ${v.total} வகுப்புகளில் ${v.present} வந்துள்ளார் (${v.percent} %), சராசரி மதிப்பெண் ${v.avg} %. செலுத்த வேண்டிய கட்டணம்: ${money(v.amount)}. கேள்விகள் இருந்தால் தெரிவிக்கவும்.`,
  code: (v) => `${v.teacher} அவர்களின் வகுப்புகளுக்கு வருக. செயலியைத் திறக்க உங்கள் குறியீடு ${v.code}.`,
  timetable: (v) => `வணக்கம், ${v.teacher} பேசுகிறேன். இந்த வாரத்தின் நேர அட்டவணை:\n${v.lines}`,
  paper: (v) => `வணக்கம், ${v.teacher} பேசுகிறேன். "${v.paper}" தாள் ${v.student} அவர்களுக்கு: ${v.link}`,
};

/** Render one template. Falls back to English if a Tamil line is missing. */
export function render(key, values, lang = 'en') {
  const fn = (lang === 'ta' && TA[key]) || EN[key];
  if (!fn) throw new Error(`Unknown message template: ${key}`);
  return fn(values || {});
}

/** The short label stored on the event row and shown in the parent's feed. */
export const FEED = {
  fee: (v) => `Fee reminder: ${v.classes} classes pending (${money(v.amount)})`,
  absent: (v) => `Marked absent for ${v.subject}`,
  class: (v) => `${v.subject} on ${v.day} at ${v.time}`,
  paid: (v) => `Payment of ${money(v.amount)} received`,
  report: () => 'Progress report sent',
  mark: (v) => `Scored ${v.score}/${v.max} in ${v.test}`,
  slip: () => 'Bank slip received, waiting for confirmation',
  join: (v) => `Welcome! Your family code is ${v.code}`,
};
