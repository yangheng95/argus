/**
 * TypedEventEmitter - A type-safe event emitter implementation
 * 
 * Provides type-safe event handling with generic event map typing.
 * All methods return `this` for chaining except emit() and listenerCount().
 */
export class TypedEventEmitter<EventMap extends Record<string, any[]>> {
  private listeners = new Map<keyof EventMap, Set<(...args: any[]) => void>>();

  /**
   * Register an event handler
   * @param event - The event name to listen for
   * @param handler - The callback function to invoke when event is emitted
   * @returns this for chaining
   */
  on<K extends keyof EventMap>(event: K, handler: (...args: EventMap[K]) => void): this {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, new Set());
    }
    this.listeners.get(event)!.add(handler as (...args: any[]) => void);
    return this;
  }

  /**
   * Remove an event handler
   * @param event - The event name
   * @param handler - The callback function to remove
   * @returns this for chaining
   */
  off<K extends keyof EventMap>(event: K, handler: (...args: EventMap[K]) => void): this {
    const handlers = this.listeners.get(event);
    if (handlers) {
      handlers.delete(handler as (...args: any[]) => void);
    }
    return this;
  }

  /**
   * Emit an event with arguments
   * @param event - The event name to emit
   * @param args - Arguments to pass to handlers
   * @returns true if there were listeners, false otherwise
   */
  emit<K extends keyof EventMap>(event: K, ...args: EventMap[K]): boolean {
    const handlers = this.listeners.get(event);
    if (!handlers || handlers.size === 0) {
      return false;
    }
    handlers.forEach(handler => handler(...args));
    return true;
  }

  /**
   * Register a one-time event handler
   * The handler is automatically removed after being called once
   * @param event - The event name to listen for
   * @param handler - The callback function to invoke
   * @returns this for chaining
   */
  once<K extends keyof EventMap>(event: K, handler: (...args: EventMap[K]) => void): this {
    const wrapper = (...args: EventMap[K]) => {
      this.off(event, wrapper);
      handler(...args);
    };
    // Store original handler reference for potential off() calls
    (wrapper as any).__originalHandler = handler;
    return this.on(event, wrapper as (...args: any[]) => void);
  }

  /**
   * Get the number of listeners for an event
   * @param event - The event name
   * @returns The number of registered listeners
   */
  listenerCount<K extends keyof EventMap>(event: K): number {
    const handlers = this.listeners.get(event);
    return handlers ? handlers.size : 0;
  }
}
