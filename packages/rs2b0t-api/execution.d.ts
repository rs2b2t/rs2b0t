export * from './index.js';
import { Execution as BaseExecution } from './index.js';

/**
 * Execution helpers plus the watchdog heartbeat available to stationary scripts.
 * @see docs/reference/api-bots.md#execution
 */
export const Execution: typeof BaseExecution & {
    /**
     * Report useful stationary work that the watchdog cannot infer from tile
     * movement or XP gain. This resets the watchdog progress timer; it does not
     * disable wedge detection.
     */
    noteProgress(): void;
};
