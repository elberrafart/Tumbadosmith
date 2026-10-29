import { h, pct } from '../dom';
import { navigate, type Screen } from '../router';
import { getLang, t } from '../../i18n';
import { chartsFor } from '../../content';
import { settings } from '../../storage/settings';
import { getAllProgress } from '../../storage/progress';
import { connectInput, inputStatus } from '../input';

export function stars(n: number): HTMLElement {
  return h('span', { class: 'stars', 'aria-label': `${t('difficulty')} ${n}/5` },
    '★'.repeat(n), h('span', { class: 'off' }, '★'.repeat(5 - n)));
}

export const riffs: Screen = (root) => {
  const list = h('div', { class: 'riff-list' });
  const lang = getLang();
  let alive = true;

  const render = (progress: Awaited<ReturnType<typeof getAllProgress>>) => {
    if (!alive) return;
    list.replaceChildren(
      ...chartsFor(settings.instrument).map((c) => {
        const p = progress.get(c.id);
        const go = (mode: 'play' | 'practice') => {
          void connectInput();
          navigate({ name: 'play', chartId: c.id, mode });
        };
        return h('article', { class: 'riff', 'data-riff': c.id },
          h('div', { class: 'row' }, h('h3', null, c.title[lang]), h('div', { class: 'spacer' }), stars(c.difficulty)),
          c.description ? h('p', null, c.description[lang]) : null,
          h('div', { class: 'meta' },
            h('span', { class: 'chip' }, `${c.bpm} BPM`),
            h('span', { class: 'chip' }, `${c.timeSig[0]}/${c.timeSig[1]}`),
            p
              ? h('span', { class: 'chip good' }, t('best', { acc: pct(p.bestAccuracy) }))
              : h('span', { class: 'chip' }, t('notPlayed')),
            p && p.bestCleanSpeed > 0 ? h('span', { class: 'chip good' }, t('topSpeed', { speed: pct(p.bestCleanSpeed) })) : null,
          ),
          h('div', { class: 'row actions' },
            h('button', { class: 'btn small primary', onclick: () => go('play') }, '▶ ' + t('playMode')),
            h('button', { class: 'btn small cyan', onclick: () => go('practice') }, '⟳ ' + t('practiceMode')),
          ),
        );
      }),
    );
  };

  root.append(
    h('div', { class: 'screen' },
      h('div', { class: 'topbar' },
        h('button', { class: 'btn ghost small', onclick: () => navigate({ name: 'menu' }) }, '← ' + t('back')),
        h('h2', null, `${t('riffs')} · ${t(settings.instrument)}`),
        h('div', { class: 'spacer' }),
        inputStatus(),
      ),
      list,
    ),
  );
  render(new Map());
  void getAllProgress().then(render);
  return () => {
    alive = false;
  };
};
