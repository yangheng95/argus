import { describe, it, expect } from 'bun:test';
import { TypedEventEmitter } from './emitter';

interface TestEvents extends Record<string, any[]> {
  message: [string];
  data: [number, string];
  click: [x: number, y: number];
}

describe('TypedEventEmitter', () => {
  describe('on(event, handler)', () => {
    it('should register event handler and return this for chaining', () => {
      const emitter = new TypedEventEmitter<TestEvents>();
      const result = emitter.on('message', (msg) => {
        expect(msg).toBe('hello');
      });
      expect(result).toBe(emitter);
    });

    it('should call handler with correct arguments', () => {
      const emitter = new TypedEventEmitter<TestEvents>();
      let received: string | undefined;
      emitter.on('message', (msg) => {
        received = msg;
      });
      emitter.emit('message', 'test message');
      expect(received).toBe('test message');
    });

    it('should support multiple handlers for same event', () => {
      const emitter = new TypedEventEmitter<TestEvents>();
      let count = 0;
      emitter.on('message', () => count++);
      emitter.on('message', () => count++);
      emitter.emit('message', 'test');
      expect(count).toBe(2);
    });
  });

  describe('off(event, handler)', () => {
    it('should remove specific handler and return this for chaining', () => {
      const emitter = new TypedEventEmitter<TestEvents>();
      const handler = () => {};
      emitter.on('message', handler);
      const result = emitter.off('message', handler);
      expect(result).toBe(emitter);
    });

    it('should remove only the specified handler', () => {
      const emitter = new TypedEventEmitter<TestEvents>();
      let count1 = 0, count2 = 0;
      const handler1 = () => count1++;
      const handler2 = () => count2++;
      emitter.on('message', handler1);
      emitter.on('message', handler2);
      emitter.off('message', handler1);
      emitter.emit('message', 'test');
      expect(count1).toBe(0);
      expect(count2).toBe(1);
    });

    it('should not throw when removing non-existent handler', () => {
      const emitter = new TypedEventEmitter<TestEvents>();
      const handler = () => {};
      expect(() => emitter.off('message', handler)).not.toThrow();
    });
  });

  describe('emit(event, ...args)', () => {
    it('should return true when listeners exist', () => {
      const emitter = new TypedEventEmitter<TestEvents>();
      emitter.on('message', () => {});
      const result = emitter.emit('message', 'test');
      expect(result).toBe(true);
    });

    it('should return false when no listeners exist', () => {
      const emitter = new TypedEventEmitter<TestEvents>();
      const result = emitter.emit('message', 'test');
      expect(result).toBe(false);
    });

    it('should call all registered handlers', () => {
      const emitter = new TypedEventEmitter<TestEvents>();
      const results: string[] = [];
      emitter.on('message', (msg) => results.push(msg + '1'));
      emitter.on('message', (msg) => results.push(msg + '2'));
      emitter.emit('message', 'hello');
      expect(results).toEqual(['hello1', 'hello2']);
    });

    it('should pass multiple arguments correctly', () => {
      const emitter = new TypedEventEmitter<TestEvents>();
      let receivedNum: number | undefined;
      let receivedStr: string | undefined;
      emitter.on('data', (num, str) => {
        receivedNum = num;
        receivedStr = str;
      });
      emitter.emit('data', 42, 'answer');
      expect(receivedNum).toBe(42);
      expect(receivedStr).toBe('answer');
    });
  });

  describe('once(event, handler)', () => {
    it('should call handler only once and return this for chaining', () => {
      const emitter = new TypedEventEmitter<TestEvents>();
      let count = 0;
      const result = emitter.once('message', () => count++);
      expect(result).toBe(emitter);
      emitter.emit('message', 'first');
      emitter.emit('message', 'second');
      expect(count).toBe(1);
    });

    it('should remove handler after first emit', () => {
      const emitter = new TypedEventEmitter<TestEvents>();
      let count = 0;
      emitter.once('message', () => count++);
      emitter.emit('message', 'test');
      expect(emitter.listenerCount('message')).toBe(0);
    });

    it('should pass arguments correctly on first emit', () => {
      const emitter = new TypedEventEmitter<TestEvents>();
      let received: string | undefined;
      emitter.once('message', (msg) => {
        received = msg;
      });
      emitter.emit('message', 'once test');
      expect(received).toBe('once test');
    });
  });

  describe('listenerCount(event)', () => {
    it('should return 0 for unregistered event', () => {
      const emitter = new TypedEventEmitter<TestEvents>();
      expect(emitter.listenerCount('message')).toBe(0);
    });

    it('should return correct count after adding handlers', () => {
      const emitter = new TypedEventEmitter<TestEvents>();
      emitter.on('message', () => {});
      expect(emitter.listenerCount('message')).toBe(1);
      emitter.on('message', () => {});
      expect(emitter.listenerCount('message')).toBe(2);
    });

    it('should return correct count after removing handlers', () => {
      const emitter = new TypedEventEmitter<TestEvents>();
      const handler = () => {};
      emitter.on('message', handler);
      emitter.on('message', () => {});
      expect(emitter.listenerCount('message')).toBe(2);
      emitter.off('message', handler);
      expect(emitter.listenerCount('message')).toBe(1);
    });

    it('should return 0 after once handler is auto-removed', () => {
      const emitter = new TypedEventEmitter<TestEvents>();
      emitter.once('message', () => {});
      expect(emitter.listenerCount('message')).toBe(1);
      emitter.emit('message', 'test');
      expect(emitter.listenerCount('message')).toBe(0);
    });
  });

  describe('chaining', () => {
    it('should support method chaining for on', () => {
      const emitter = new TypedEventEmitter<TestEvents>();
      const result = emitter
        .on('message', () => {})
        .on('data', () => {})
        .on('click', () => {});
      expect(result).toBe(emitter);
      expect(emitter.listenerCount('message')).toBe(1);
      expect(emitter.listenerCount('data')).toBe(1);
      expect(emitter.listenerCount('click')).toBe(1);
    });

    it('should support method chaining for off', () => {
      const emitter = new TypedEventEmitter<TestEvents>();
      const h1 = () => {};
      const h2 = () => {};
      emitter.on('message', h1).on('message', h2);
      const result = emitter.off('message', h1).off('message', h2);
      expect(result).toBe(emitter);
      expect(emitter.listenerCount('message')).toBe(0);
    });

    it('should support method chaining for once', () => {
      const emitter = new TypedEventEmitter<TestEvents>();
      const result = emitter
        .once('message', () => {})
        .once('data', () => {})
        .once('click', () => {});
      expect(result).toBe(emitter);
      expect(emitter.listenerCount('message')).toBe(1);
      expect(emitter.listenerCount('data')).toBe(1);
      expect(emitter.listenerCount('click')).toBe(1);
    });

    it('should support mixed chaining', () => {
      const emitter = new TypedEventEmitter<TestEvents>();
      const h1 = () => {};
      emitter
        .on('message', h1)
        .once('data', () => {})
        .off('message', h1)
        .on('click', () => {});
      expect(emitter.listenerCount('message')).toBe(0);
      expect(emitter.listenerCount('data')).toBe(1);
      expect(emitter.listenerCount('click')).toBe(1);
    });
  });

  describe('edge cases', () => {
    it('should handle emit with no arguments', () => {
      interface SimpleEvents extends Record<string, any[]> {
        ping: [];
      }
      const emitter = new TypedEventEmitter<SimpleEvents>();
      let called = false;
      emitter.on('ping', () => {
        called = true;
      });
      emitter.emit('ping');
      expect(called).toBe(true);
    });

    it('should handle multiple once handlers', () => {
      const emitter = new TypedEventEmitter<TestEvents>();
      let count1 = 0, count2 = 0;
      emitter.once('message', () => count1++);
      emitter.once('message', () => count2++);
      emitter.emit('message', 'first');
      emitter.emit('message', 'second');
      expect(count1).toBe(1);
      expect(count2).toBe(1);
    });
  });
});
