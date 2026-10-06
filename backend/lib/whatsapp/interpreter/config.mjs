import { z } from 'zod';

export const settingsSchema = z.object({
    enabled: z.boolean().default(false),
    bookingEnabled: z.boolean().default(true),
    ticketEnabled: z.boolean().default(true),
    defaultDate: z.enum(['ask', 'today']).default('ask'),
    pilotUserIds: z.array(z.string().uuid()).max(100).default([]),
}).strict();

export const defaultSettings = settingsSchema.parse({});
export function pilotAllowed(settings, userId) {
    const value = settingsSchema.safeParse(settings);
    return value.success && value.data.enabled && value.data.pilotUserIds.includes(userId);
}
