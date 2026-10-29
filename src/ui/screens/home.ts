import { h } from '../dom';
import { navigate, refresh, type Screen } from '../router';
import { getLang, setLang, t, type Lang } from '../../i18n';
import { saveSettings, settings } from '../../storage/settings';
import { connectInput, inputStatus } from '../input';
import type { Instrument } from '../../chart/types';

export function langToggle(): HTMLElement {
  const btn = (l: Lang, label: string) =>
    h('button', {
      'aria-pressed': String(getLang() === l),
      onclick: () => {
        settings.lang = l;
        saveSettings();
        setLang(l);
        refresh();
      },
    }, label);
  return h('div', { class: 'lang-toggle', role: 'group', 'aria-label': t('language') }, btn('es', 'ES'), btn('en', 'EN'));
}

export const home: Screen = (root) => {
  const pick = (inst: Instrument) => {
    settings.instrument = inst;
    saveSettings();
    // Starting audio here keeps it inside the tap, which iPad Safari requires.
    void connectInput();
    navigate({ name: 'menu' });
  };
  root.append(
    h('div', { class: 'screen' },
      h('div', { class: 'topbar' }, h('div', { class: 'spacer' }), langToggle(),
        h('button', { class: 'btn ghost small', onclick: () => navigate({ name: 'settings', from: 'home' }) }, '⚙ ' + t('settings'))),
      h('h1', { class: 'logo' }, 'Tumbadosmith', h('small', null, 'Corridos tumbados')),
      h('p', { class: 'tagline' }, t('appTagline')),
      h('h2', { style: 'text-align:center;font-size:26px;color:var(--muted)' }, t('chooseInstrument')),
      h('div', { class: 'cards' },
        h('button', { class: 'card', 'data-instrument': 'guitar', onclick: () => pick('guitar') },
          h('span', { class: 'icon' }, '🎸'), h('h3', null, t('guitar')), h('p', null, t('guitarSub'))),
        h('button', { class: 'card cyan', 'data-instrument': 'bass', onclick: () => pick('bass') },
          h('span', { class: 'icon' }, '🎻'), h('h3', null, t('bass')), h('p', null, t('bassSub'))),
      ),
      h('p', { class: 'hint', style: 'text-align:center' }, t('cableHint')),
    ),
  );
};

export const menu: Screen = (root) => {
  const inst = settings.instrument;
  root.append(
    h('div', { class: 'screen' },
      h('div', { class: 'topbar' },
        h('button', { class: 'btn ghost small', onclick: () => navigate({ name: 'home' }) }, '← ' + t('back')),
        h('h2', null, t(inst)),
        h('div', { class: 'spacer' }),
        langToggle(),
      ),
      inputStatusRow(),
      h('div', { class: 'cards' },
        h('button', { class: 'card cyan', onclick: () => navigate({ name: 'tuner' }) },
          h('span', { class: 'icon' }, '🎯'), h('h3', null, t('tuner')), h('p', null, t('tunerSub'))),
        h('button', { class: 'card', onclick: () => navigate({ name: 'riffs' }) },
          h('span', { class: 'icon' }, '🔥'), h('h3', null, t('riffs')), h('p', null, t('riffsSub'))),
        h('button', { class: 'card cyan', onclick: () => navigate({ name: 'settings', from: 'menu' }) },
          h('span', { class: 'icon' }, '⚙'), h('h3', null, t('settings')), h('p', null, t('latency') + ' · ' + t('tuning') + ' · ' + t('inputDevice'))),
      ),
    ),
  );
};

function inputStatusRow(): HTMLElement {
  return h('div', { class: 'row' }, inputStatus());
}
