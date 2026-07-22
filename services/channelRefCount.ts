/**
 * Reference-counted resource map — used by Pusher channel subscriptions
 * so multiple consumers can share one underlying channel safely.
 */

export class ChannelRefCounter<T> {
  private refs = new Map<string, { value: T; count: number }>();

  acquire(name: string, create: () => T | null): T | null {
    const existing = this.refs.get(name);
    if (existing) {
      existing.count += 1;
      return existing.value;
    }
    const value = create();
    if (value == null) return null;
    this.refs.set(name, { value, count: 1 });
    return value;
  }

  release(name: string, destroy: (name: string) => void): void {
    const existing = this.refs.get(name);
    if (!existing) {
      destroy(name);
      return;
    }
    existing.count -= 1;
    if (existing.count > 0) return;
    this.refs.delete(name);
    destroy(name);
  }

  clear(destroyAll: (names: string[]) => void): void {
    const names = Array.from(this.refs.keys());
    this.refs.clear();
    destroyAll(names);
  }

  count(name: string): number {
    return this.refs.get(name)?.count ?? 0;
  }

  names(): string[] {
    return Array.from(this.refs.keys());
  }
}
