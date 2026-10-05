export function useParams<T = { orgId: string }>(): T { return { orgId: '00000000-0000-0000-0000-000000000001' } as T; }
export function usePathname() { return window.location.pathname; }
