// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { HoldButton } from './HoldButton';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let host: HTMLDivElement;
let root: Root;
const onConfirm = vi.fn();

const mount = (props: Partial<React.ComponentProps<typeof HoldButton>> = {}) => {
  act(() => { root.render(<HoldButton label="Emetti" onConfirm={onConfirm} {...props} />); });
  return host.querySelector<HTMLButtonElement>('button.hold-btn')!;
};
const fire = (el: Element, type: string, init: Record<string, unknown> = {}) =>
  act(() => { el.dispatchEvent(Object.assign(new Event(type, { bubbles: true, cancelable: true }), init)); });
const wait = (ms: number) => act(() => { vi.advanceTimersByTime(ms); });

beforeEach(() => {
  vi.useFakeTimers();
  onConfirm.mockReset();
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
});
afterEach(() => { act(() => root.unmount()); host.remove(); vi.useRealTimers(); });

describe('HoldButton (conferma a pressione prolungata)', () => {
  it('conferma solo dopo ~1,2 s di pressione continua', () => {
    const b = mount();
    fire(b, 'pointerdown', { button: 0 });
    wait(600);
    expect(onConfirm).not.toHaveBeenCalled();
    expect(host.querySelector('[role="progressbar"]')!.getAttribute('aria-valuenow')).not.toBe('0');
    wait(700);
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });
  it('rilasciando prima il progresso si azzera e non conferma', () => {
    const b = mount();
    fire(b, 'pointerdown', { button: 0 });
    wait(900);
    fire(b, 'pointerup');
    wait(1000);
    expect(onConfirm).not.toHaveBeenCalled();
    expect(host.querySelector('[role="progressbar"]')!.getAttribute('aria-valuenow')).toBe('0');
  });
  it('un semplice tocco non conferma e spiega cosa fare', () => {
    const b = mount();
    fire(b, 'pointerdown', { button: 0 });
    wait(100);
    fire(b, 'pointerup');
    fire(b, 'click');
    expect(onConfirm).not.toHaveBeenCalled();
    expect(host.textContent).toContain('Un tocco non basta');
  });
  it('da tastiera: tenendo premuto Spazio conferma, rilasciando prima no', () => {
    const b = mount();
    fire(b, 'keydown', { key: ' ' });
    wait(500);
    fire(b, 'keyup', { key: ' ' });
    wait(1500);
    expect(onConfirm).not.toHaveBeenCalled();
    fire(b, 'keydown', { key: 'Enter' });
    wait(1300);
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });
  it('disabilitato o occupato: non parte', () => {
    const b = mount({ disabled: true });
    fire(b, 'pointerdown', { button: 0 });
    wait(2000);
    expect(onConfirm).not.toHaveBeenCalled();
  });
  it('alternativa: digitando CONFERMO si abilita il pulsante', () => {
    mount();
    const input = host.querySelector<HTMLInputElement>('details input')!;
    const alt = [...host.querySelectorAll('details button')].find((x) => x.textContent?.includes('con parola')) as HTMLButtonElement;
    expect(alt.disabled).toBe(true);
    act(() => {
      const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
      set.call(input, 'confermo');
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    expect(alt.disabled).toBe(false);
    act(() => { alt.click(); });
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });
});
