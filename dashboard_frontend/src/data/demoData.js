/**
 * Demo data compatibility shim.
 *
 * Some parts of the UI/state now import from `../data/demoData` as the single seam
 * for swapping demo JSON -> API later.
 *
 * The repo currently persists demo seed data in `dummyData.js`; this file re-exports
 * those symbols so builds succeed and the rest of the app can rely on the stable
 * `demoData` import path.
 *
 * When you later move fully to JSON file imports, replace the exports here with
 * JSON-backed exports (keeping the same public interface).
 */

export * from "./dummyData";
