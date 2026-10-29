import './styles.css';
import { setLang } from './i18n';
import { settings } from './storage/settings';
import { mount, navigate, register } from './ui/router';
import { home, menu } from './ui/screens/home';
import { tuner } from './ui/screens/tuner';
import { riffs } from './ui/screens/riffs';
import { play } from './ui/screens/play';
import { results } from './ui/screens/results';
import { settingsScreen } from './ui/screens/settings';
import { calibrate } from './ui/screens/calibrate';

setLang(settings.lang);
register('home', home);
register('menu', menu);
register('tuner', tuner);
register('riffs', riffs);
register('play', play);
register('results', results);
register('settings', settingsScreen);
register('calibrate', calibrate);
mount(document.getElementById('app')!);
navigate({ name: 'home' });

if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => void navigator.serviceWorker.register('./sw.js').catch(() => {}));
}
