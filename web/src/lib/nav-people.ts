import { savePeopleOpen } from './sidebar';

/**
 * Sidebar "People" folder. The markup is server-rendered (AppLayout) and `<html data-people>`
 * is set before paint, so this only wires behaviour. The folder is inline in every mode (wide
 * sidebar, icons-only rail, phone sheet): the button expands/collapses the group, the choice is
 * remembered per device, and a folder holding the current page starts open whatever was saved.
 * The button is a native <button>, so Enter/Space toggle it; focus never moves.
 */
const folder = document.querySelector<HTMLElement>('[data-nav-folder]');
const toggle = folder?.querySelector<HTMLButtonElement>('.nav-folder-toggle');
const panel = folder?.querySelector<HTMLElement>('.nav-folder-panel');

if (folder && toggle && panel) {
  const links = () => Array.from(panel.querySelectorAll<HTMLAnchorElement>('a'));
  const hasCurrent = folder.hasAttribute('data-current');
  const isOpen = () => folder.dataset.state
    ? folder.dataset.state === 'open'
    : !!hasCurrent || document.documentElement.dataset.people !== 'closed';
  const sync = () => toggle.setAttribute('aria-expanded', String(isOpen()));
  const set = (open: boolean) => {
    folder.dataset.state = open ? 'open' : 'closed';
    savePeopleOpen(open);
    sync();
  };

  toggle.addEventListener('click', () => set(!isOpen()));

  folder.addEventListener('keydown', (e) => {
    const items = links();
    const i = items.indexOf(document.activeElement as HTMLAnchorElement);
    if (e.key === 'ArrowDown' && document.activeElement === toggle) {
      e.preventDefault();
      if (!isOpen()) set(true);
      items[0]?.focus();
    } else if (e.key === 'ArrowDown' && i >= 0) {
      e.preventDefault();
      items[Math.min(i + 1, items.length - 1)]?.focus();
    } else if (e.key === 'ArrowUp' && i >= 0) {
      e.preventDefault();
      (i === 0 ? toggle : items[i - 1])?.focus();
    } else if (e.key === 'ArrowRight' && document.activeElement === toggle && !isOpen()) {
      e.preventDefault();
      set(true);
    } else if (e.key === 'ArrowLeft' && isOpen() && (document.activeElement === toggle || i >= 0)) {
      e.preventDefault();
      set(false);
      toggle.focus();
    } else if ((e.key === 'Home' || e.key === 'End') && i >= 0) {
      e.preventDefault();
      items[e.key === 'Home' ? 0 : items.length - 1]?.focus();
    }
  });

  sync();
}
