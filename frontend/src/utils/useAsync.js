import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Load data on mount (and when deps change). Returns { data, error, loading, reload, setData }.
 */
export function useAsync(loader, deps = []) {
    const [state, setState] = useState({ data: null, error: null, loading: true });
    const alive = useRef(true);
    const loaderRef = useRef(loader);
    loaderRef.current = loader;

    const reload = useCallback(async () => {
        setState((s) => ({ ...s, loading: true, error: null }));
        try {
            const data = await loaderRef.current();
            if (alive.current) setState({ data, error: null, loading: false });
        } catch (error) {
            if (alive.current) setState({ data: null, error, loading: false });
        }
    }, []);

    useEffect(() => {
        alive.current = true;
        reload();
        return () => {
            alive.current = false;
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, deps);

    const setData = useCallback((data) => setState((s) => ({ ...s, data })), []);
    return { ...state, reload, setData };
}
