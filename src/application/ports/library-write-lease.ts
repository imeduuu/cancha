/** Issued by infrastructure while the browser owns the library lock. */
export interface LibraryWriteLease { readonly libraryWriteLease: unique symbol }
