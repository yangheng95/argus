/**
 * A type-safe event emitter that supports typed event handlers.
 * @template T - Type mapping of event names to their handler argument types
 */
export class TypedEventEmitter<T extends Record<keyof T, any[]>> {
  private listeners: Map<keyof T, Array<(...args: any[]) => void>> = new Map();

  /**
   * Register an event listener
   * @param event - The event name to listen for
   * @param handler - The callback function to invoke when event is emitted
   * @returns this (for chaining)
   */
  on<K extends keyof T>(event: K, handler: (...args: T[K]) => void): this {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, []);
    }
    this.listeners.get(event)!.push(handler);
    return this;
  }

  /**
   * Remove an event listener
   * @param event - The event name
   * @param handler - The callback function to remove
   * @returns this (for chaining)
   */
  off<K extends keyof T>(event: K, handler: (...args: T[K]) => void): this {
    const handlers = this.listeners.get(event);
    if (handlers) {
      const index = handlers.indexOf(handler);
      if (index !== -1) {
        handlers.splice(index, 1);
      }
    }
    return this;
  }

  /**
   * Emit an event with arguments
   * @param event - The event name to emit
   * @param args - Arguments to pass to handlers
   * @returns true if any listeners were called, false otherwise
   */
  emit<K extends keyof T>(event: K, ...args: T[K]): boolean {
    const handlers = this.listeners.get(event);
    if (!handlers || handlers.length === 0) {
      return false;
    }
    // Copy array to prevent issues if handlers modify the list during iteration
    const handlersCopy = handlers.slice();
    for (const handler of handlersCopy) {
      handler(...args);
    }
    return true;
  }

  /**
   * Register a one-time event listener (automatically removed after first trigger)
   * @param event - The event name to listen for
   * @param handler - The callback function to invoke
   * @returns this (for chaining)
   */
  once<K extends keyof T>(event: K, handler: (...args: T[K]) => void): this {
    const onceHandler = (...args: T[K]) => {
      this.off(event, onceHandler);
      handler(...args);
    };
    this.on(event, onceHandler);
    return this;
  }

  /**
   * Get the number of listeners for a specific event
   * @param event - The event name
   * @returns The number of registered listeners
   */
  listenerCount<K extends keyof T>(event: K): number {
    const handlers = this.listeners.get(event);
    return handlers ? handlers.length : 0;
  }
}
