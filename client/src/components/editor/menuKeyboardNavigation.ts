export function moveMenuRadioFocus(
  event: Pick<KeyboardEvent, 'key' | 'preventDefault'>,
  menu: HTMLElement | null
): boolean {
  if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return false;
  const options = Array.from(
    menu?.querySelectorAll<HTMLButtonElement>('[role="menuitemradio"]') ?? []
  );
  if (!options.length) return true;

  event.preventDefault();
  const currentIndex = options.indexOf(
    document.activeElement as HTMLButtonElement
  );
  const direction = event.key === 'ArrowDown' ? 1 : -1;
  const nextIndex =
    (currentIndex + direction + options.length) % options.length;
  options[nextIndex]?.focus();
  return true;
}
