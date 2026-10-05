import { createContext, useContext } from 'react'

/** Flips to true once the preloader has lifted, so the hero can start its entrance. */
export const ReadyContext = createContext(false)
export const useReady = () => useContext(ReadyContext)
