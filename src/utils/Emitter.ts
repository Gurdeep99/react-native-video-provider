export type Listener<P> = (payload: P) => void;

export interface Subscription {
  remove(): void;
}

/**
 * Minimal typed event emitter. Listener errors are isolated so one broken
 * subscriber cannot break playback state propagation.
 */
export class Emitter<Events extends object> {
  private listeners = new Map<keyof Events, Set<Listener<never>>>();

  addListener<K extends keyof Events>(
    event: K,
    listener: Listener<Events[K]>
  ): Subscription {
    let set = this.listeners.get(event);
    if (!set) {
      set = new Set();
      this.listeners.set(event, set);
    }
    set.add(listener as Listener<never>);
    return {
      remove: () => {
        set.delete(listener as Listener<never>);
      },
    };
  }

  emit<K extends keyof Events>(event: K, payload: Events[K]): void {
    const set = this.listeners.get(event);
    if (!set) {
      return;
    }
    for (const listener of Array.from(set)) {
      try {
        (listener as Listener<Events[K]>)(payload);
      } catch (e) {
        console.error(`[react-native-video-provider] listener for ${String(event)} threw`, e);
      }
    }
  }

  removeAll(): void {
    this.listeners.clear();
  }
}
