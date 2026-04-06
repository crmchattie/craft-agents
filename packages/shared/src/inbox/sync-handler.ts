/**
 * InboxSyncHandler — bridges the sync service to the EventBus SchedulerTick.
 *
 * Subscribes to SchedulerTick and triggers inbox sync on each tick.
 * The sync service internally checks whether enough time has passed,
 * so the handler fires every minute but syncs only happen every N minutes.
 */

import type { EventBus, SchedulerTickPayload } from '../automations/event-bus.ts';
import type { InboxSyncService } from './sync-service.ts';
import { createLogger } from '../utils/debug.ts';

const log = createLogger('inbox-sync-handler');

export class InboxSyncHandler {
  private readonly syncService: InboxSyncService;
  private readonly eventBus: EventBus;
  private readonly handler: (payload: SchedulerTickPayload) => Promise<void>;

  constructor(syncService: InboxSyncService, eventBus: EventBus) {
    this.syncService = syncService;
    this.eventBus = eventBus;
    this.handler = async (_payload: SchedulerTickPayload) => {
      try {
        log.debug('SchedulerTick received, triggering sync');
        await this.syncService.sync(false);
      } catch (error) {
        log.error('Inbox sync on SchedulerTick failed:', error);
      }
    };
  }

  start(): void {
    this.eventBus.on('SchedulerTick', this.handler);
    log.debug('InboxSyncHandler registered on SchedulerTick');
  }

  stop(): void {
    this.eventBus.off('SchedulerTick', this.handler);
    log.debug('InboxSyncHandler unregistered from SchedulerTick');
  }

  /** Manual sync — bypasses interval check. Returns sync result. */
  async triggerManualSync() {
    return this.syncService.sync(true);
  }
}
