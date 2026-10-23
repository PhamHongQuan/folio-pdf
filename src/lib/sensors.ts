import { TouchSensor, type TouchSensorOptions } from '@dnd-kit/core';

type TouchSensorProps = ConstructorParameters<typeof TouchSensor>[0];
type Constraint = TouchSensorOptions['activationConstraint'];

export interface SmartTouchOptions extends TouchSensorOptions {
  /** Constraint used when the touch starts on a `[data-drag-handle]` element. */
  handleConstraint?: Constraint;
}

/**
 * One touch sensor with two behaviours (dnd-kit binds only one listener per
 * event name, so two separate touch sensors cannot coexist):
 * - touch starting on the ⠿ handle → `handleConstraint` (a small distance: drag at once);
 * - anywhere else → `activationConstraint` (a long-press), so ordinary swipes keep scrolling.
 */
export class SmartTouchSensor extends TouchSensor {
  constructor(props: TouchSensorProps) {
    const options = props.options as SmartTouchOptions;
    const target = props.event.target as Element | null;
    const onHandle = !!target?.closest?.('[data-drag-handle]');
    super(
      onHandle && options.handleConstraint
        ? { ...props, options: { ...options, activationConstraint: options.handleConstraint } }
        : props,
    );
  }
}

/** Blocks page scrolling (and pull-to-refresh) while a page is being dragged on a touch screen. */
export function lockTouchScroll(): () => void {
  const prevent = (e: Event) => {
    if (e.cancelable) e.preventDefault();
  };
  window.addEventListener('touchmove', prevent, { passive: false });
  document.documentElement.classList.add('dragging');
  return () => {
    window.removeEventListener('touchmove', prevent);
    document.documentElement.classList.remove('dragging');
  };
}
