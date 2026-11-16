import { createContext, useContext } from "react";

export type LibraryWrite = <T>(action: () => T) => T | Promise<T>;
// Standalone components and in-memory repositories can still run synchronously.
export const LibraryWriteContext = createContext<LibraryWrite>(action => action());
export function useLibraryWrite() { return useContext(LibraryWriteContext); }
