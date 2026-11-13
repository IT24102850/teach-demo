/**
 * The account sheets every signed-in person shares, and the ones only a
 * parent has (migration 008):
 *
 *   everyone   change my password · the devices I am signed in on, and
 *              "sign out everywhere else"
 *   parent     my children's own student logins: make one, set a new
 *              password, remove it · add another child with an invite code
 *
 * Teachers reach these from Settings, families from their settings sheet.
 * Nothing here decides who may do what - the server does - so a student who
 * opened a parent's sheet some other way would only get "Only a parent can
 * do this" back.
 */

import { api } from '../api.js';
import { t } from '../i18n.js';
import { S } from '../state.js';
import {
  actionButton,
  button,
  card,
  closeSheet,
  esc,
  field,
  label,
  muted,
  openSheet,
  sheetActions,
  sheetTitle,
  toast,
} from '../ui.js';

const val = (id) => document.getElementById(id)?.value ?? '';

/** The buttons for the settings sheet: what this person may manage. */
export function accountButtons() {
  const parent = S.role === 'parent';
  return `
    ${label(t('account'))}
    ${parent ? button(t('student_logins'), { act: 'account.logins', cls: 'o wide' }) : ''}
    ${parent ? button(t('add_another_child'), { act: 'account.addchild', cls: 'o wide' }) : ''}
    ${button(t('change_password'), { act: 'account.password', cls: 'o wide' })}
    ${button(t('signed_in_devices'), { act: 'account.devices', cls: 'gh wide' })}`;
}

/** "Chrome on Android" from a user-agent string - enough to recognise a phone. */
function deviceName(ua = '') {
  const browser = /Edg\//.test(ua)
    ? 'Edge'
    : /SamsungBrowser/.test(ua)
      ? 'Samsung Internet'
      : /Chrome\//.test(ua)
        ? 'Chrome'
        : /Firefox\//.test(ua)
          ? 'Firefox'
          : /Safari\//.test(ua)
            ? 'Safari'
            : t('a_browser');
  const os = /iPhone|iPad/.test(ua)
    ? 'iPhone'
    : /Android/.test(ua)
      ? 'Android'
      : /Windows/.test(ua)
        ? 'Windows'
        : /Mac OS X/.test(ua)
          ? 'Mac'
          : /Linux/.test(ua)
            ? 'Linux'
            : '';
  return os ? t('browser_on', { browser, os }) : browser;
}

const when = (iso) =>
  iso ? new Date(iso).toLocaleString(S.lang === 'ta' ? 'ta-LK' : 'en-GB', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' }) : '';

/* ---------------------------------------------------------- the logins --- */

async function loginsSheet() {
  const { children } = await api.familyLogins();
  openSheet(`
    ${sheetTitle(t('student_logins'))}
    ${muted(t('student_logins_blurb'))}
    ${children
      .map((c) =>
        card(
          `<b>${esc(c.name)}</b>
           ${
             c.login
               ? `${muted(`${t('username')}: ${c.login.username}${c.login.last_login_at ? ` · ${t('last_used', { when: when(c.login.last_login_at) })}` : ''}`)}
                  <div class="row gap mt-s">
                    ${button(t('new_password'), { act: 'account.loginpass', arg: c.id, cls: 'sm o' })}
                    ${button(t('remove'), { act: 'account.logindelete', arg: c.id, cls: 'sm gh' })}
                  </div>`
               : `${muted(t('no_student_login_yet'))}
                  ${button(t('make_student_login'), { act: 'account.logincreate', arg: c.id, cls: 'sm mt-s' })}`
           }`,
        ),
      )
      .join('')}
    ${button(t('done'), { act: 'sheet.close', cls: 'wide mt' })}
  `);
}

/* ------------------------------------------------------------- actions --- */

export const ACCOUNT_ACTIONS = {
  'account.logins': () => loginsSheet(),

  'account.logincreate': (studentId) => {
    const child = (S.children || []).find((c) => c.id === studentId);
    const suggestion = String(child?.call_name || child?.name || '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '.')
      .replace(/^\.|\.$/g, '')
      .slice(0, 20);
    openSheet(`
      ${sheetTitle(t('make_student_login'))}
      ${muted(child?.name || '')}
      ${field('al-user', t('username'), { value: suggestion, placeholder: 'kasun.p' })}
      <p class="fld-hint">${esc(t('username_rule'))}</p>
      ${field('al-pass', t('password'), { type: 'password' })}
      <p class="fld-hint">${esc(t('password_rule'))}</p>
      ${sheetActions('account.logincreatesave', t('save'), studentId)}
    `);
  },
  'account.logincreatesave': async (studentId) => {
    try {
      const result = await api.studentLoginCreate({
        student_id: studentId,
        username: val('al-user').trim(),
        password: val('al-pass'),
      });
      toast(t('student_login_made', { username: result.username }));
      await loginsSheet();
    } catch (err) {
      toast(err.message, 'bad');
    }
  },

  'account.loginpass': (studentId) => {
    openSheet(`
      ${sheetTitle(t('new_password'))}
      ${field('al-pass', t('new_password'), { type: 'password' })}
      <p class="fld-hint">${esc(t('password_rule'))}</p>
      ${sheetActions('account.loginpasssave', t('save'), studentId)}
    `);
  },
  'account.loginpasssave': async (studentId) => {
    try {
      await api.studentLoginPassword({ student_id: studentId, password: val('al-pass') });
      toast(t('password_changed'));
      await loginsSheet();
    } catch (err) {
      toast(err.message, 'bad');
    }
  },

  'account.logindelete': (studentId) => {
    openSheet(`
      ${sheetTitle(t('remove_student_login'))}
      ${muted(t('remove_student_login_blurb'))}
      ${actionButton(t('remove'), { act: 'account.logindeletesave', arg: studentId, cls: 'd wide' })}
      ${button(t('cancel'), { act: 'account.logins', cls: 'o wide' })}
    `);
  },
  'account.logindeletesave': async (studentId) => {
    try {
      await api.studentLoginDelete(studentId);
      await loginsSheet();
    } catch (err) {
      toast(err.message, 'bad');
    }
  },

  'account.addchild': () => {
    openSheet(`
      ${sheetTitle(t('add_another_child'))}
      ${muted(t('add_child_blurb'))}
      ${field('al-code', t('invite_code'), { inputmode: 'numeric', placeholder: '123456' })}
      ${sheetActions('account.addchildsave', t('add'))}
    `);
  },
  'account.addchildsave': async (_a, _el, ctx) => {
    try {
      const summary = await api.addChild(val('al-code').replace(/\D/g, ''));
      closeSheet();
      S.children = summary.children || S.children;
      await ctx.reload();
      ctx.render();
      toast(t('child_added'));
    } catch (err) {
      toast(err.message, 'bad');
    }
  },

  'account.password': () => {
    openSheet(`
      ${sheetTitle(t('change_password'))}
      ${field('ap-cur', t('current_password'), { type: 'password' })}
      ${field('ap-new', t('new_password'), { type: 'password' })}
      ${field('ap-again', t('new_password_again'), { type: 'password' })}
      <p class="fld-hint">${esc(t('password_rule'))} ${esc(t('password_signs_out'))}</p>
      ${sheetActions('account.passwordsave', t('save'))}
    `);
  },
  'account.passwordsave': async () => {
    const next = val('ap-new');
    if (next !== val('ap-again')) return toast(t('passwords_differ'), 'bad');
    try {
      await api.changePassword(val('ap-cur'), next);
      closeSheet();
      toast(t('password_changed'));
    } catch (err) {
      toast(err.message, 'bad');
    }
  },

  'account.devices': async () => {
    const { sessions } = await api.devices();
    openSheet(`
      ${sheetTitle(t('signed_in_devices'))}
      ${sessions
        .map((s) =>
          card(
            `<div class="row sp"><b>${esc(deviceName(s.user_agent))}</b>${
              s.current ? `<span class="pill t">${esc(t('this_device'))}</span>` : ''
            }</div>${muted(t('last_used', { when: when(s.last_seen_at) }))}`,
          ),
        )
        .join('')}
      ${
        sessions.length > 1
          ? actionButton(t('sign_out_others'), { act: 'account.signoutothers', cls: 'd wide' })
          : ''
      }
      ${button(t('done'), { act: 'sheet.close', cls: 'o wide' })}
    `);
  },
  'account.signoutothers': async () => {
    await api.signOutOthers();
    closeSheet();
    toast(t('signed_out_others'));
  },
};
