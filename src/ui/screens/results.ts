import { h, pct } from '../dom';
import { navigate, type Screen } from '../router';
import { getLang, t } from '../../i18n';
import { chartById } from '../../content';

export const results: Screen = (root, route) => {
  if (route.name !== 'results') return;
  const chart = chartById(route.chartId)!;
  const r = route.result;
  const lang = getLang();
  const stat = (k: string, v: string | number) => h('div', { class: 'stat' }, h('div', { class: 'v' }, v), h('div', { class: 'k' }, k));

  root.append(
    h('div', { class: 'screen' },
      h('div', { class: 'topbar' },
        h('button', { class: 'btn ghost small', onclick: () => navigate({ name: 'riffs' }) }, '← ' + t('backToRiffs')),
        h('h2', null, `${t('results')} · ${chart.title[lang]}`),
      ),
      h('div', { class: 'big-acc', 'data-testid': 'accuracy' }, pct(r.accuracy)),
      route.newBest ? h('div', { class: 'badge' }, t('newBest')) : null,
      h('div', { class: 'stats' },
        stat(t('score'), r.score.toLocaleString()),
        stat(t('perfectCount'), r.counts.perfect),
        stat(t('goodCount'), r.counts.good),
        stat(t('missCount'), r.counts.miss),
        stat(t('bestStreak'), r.bestStreak),
        stat(t('speed'), pct(r.speed)),
        r.bestCleanSpeed > 0 ? stat(t('cleanSpeed'), pct(r.bestCleanSpeed)) : null,
      ),
      h('div', { class: 'panel-box' },
        h('h3', null, t('sections')),
        h('div', { class: 'section-bars' },
          ...r.sections.map((s) => {
            const acc = s.total ? s.hits / s.total : 0;
            return h('div', { class: 'section-bar' },
              h('span', null, s.name),
              h('div', { class: 'track' }, h('div', { class: 'fill', style: `width:${acc * 100}%` })),
              h('strong', null, s.total ? pct(acc) : '–'));
          }),
        ),
      ),
      h('div', { class: 'row', style: 'justify-content:center' },
        h('button', { class: 'btn primary', onclick: () => navigate({ name: 'play', chartId: chart.id, mode: route.mode }) }, '⟲ ' + t('playAgain')),
        route.mode === 'play'
          ? h('button', { class: 'btn cyan', onclick: () => navigate({ name: 'play', chartId: chart.id, mode: 'practice' }) }, t('practiceThis'))
          : null,
        h('button', { class: 'btn ghost', onclick: () => navigate({ name: 'riffs' }) }, t('backToRiffs')),
      ),
    ),
  );
};
