// In-memory cache for HR Module with Stale-While-Revalidate (SWR) support
// Eliminates loading spinners on tab switches and page navigations

interface CacheEntry<T> {
    data: T;
    timestamp: number;
}

const TICKET_CACHE_TTL_MS = 60 * 1000; // 1 minute fresh TTL
const EMPLOYEE_CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes fresh TTL
const PROPERTY_CACHE_TTL_MS = 10 * 60 * 1000; // 10 minutes fresh TTL

class HRDataCache {
    private tickets = new Map<string, CacheEntry<any[]>>();
    private employees = new Map<string, CacheEntry<any[]>>();
    private properties = new Map<string, CacheEntry<any[]>>();

    // Tickets
    getTickets(key: string): { data: any[] | null; isStale: boolean } {
        const entry = this.tickets.get(key);
        if (!entry) return { data: null, isStale: true };
        const isStale = Date.now() - entry.timestamp > TICKET_CACHE_TTL_MS;
        return { data: entry.data, isStale };
    }

    setTickets(key: string, data: any[]): void {
        this.tickets.set(key, { data, timestamp: Date.now() });
    }

    updateTicketStatus(ticketId: string, newStatus: string): void {
        this.tickets.forEach(entry => {
            entry.data = entry.data.map(t => t.id === ticketId ? { ...t, status: newStatus } : t);
        });
    }

    // Employees
    getEmployees(orgId: string): { data: any[] | null; isStale: boolean } {
        const key = orgId || 'all';
        const entry = this.employees.get(key);
        if (!entry) return { data: null, isStale: true };
        const isStale = Date.now() - entry.timestamp > EMPLOYEE_CACHE_TTL_MS;
        return { data: entry.data, isStale };
    }

    setEmployees(orgId: string, data: any[]): void {
        const key = orgId || 'all';
        this.employees.set(key, { data, timestamp: Date.now() });
    }

    // Properties
    getProperties(orgId: string): { data: any[] | null; isStale: boolean } {
        const key = orgId || 'all';
        const entry = this.properties.get(key);
        if (!entry) return { data: null, isStale: true };
        const isStale = Date.now() - entry.timestamp > PROPERTY_CACHE_TTL_MS;
        return { data: entry.data, isStale };
    }

    setProperties(orgId: string, data: any[]): void {
        const key = orgId || 'all';
        this.properties.set(key, { data, timestamp: Date.now() });
    }

    // Clear / Invalidate
    invalidateAll(): void {
        this.tickets.clear();
        this.employees.clear();
        this.properties.clear();
    }
}

export const hrDataCache = new HRDataCache();
