/*
 * Package the clinic application for Sites hosting.
 *
 * Run this script with `npm run build` from the repository root. All paths below
 * are relative to that working directory. The application already consists of
 * JavaScript ES modules, so packaging only needs to copy files; there is no
 * compilation, bundling, or dependency installation in this step.
 *
 * The generated layout is:
 *   dist/server/           Worker entrypoint, API logic, and embedded HTML page
 *   dist/.openai/          Sites project identity and storage binding declarations
 *   dist/drizzle/          SQL migrations for the persistent booking database
 *
 * This script prepares files only. Publishing, configuring runtime secrets, and
 * applying hosted database migrations are separate deployment responsibilities.
 */
import {mkdir,copyFile,cp} from 'node:fs/promises';

/*
 * Create the output directories before copying files into them. `recursive`
 * creates any missing parent directories and permits directories that already
 * exist, allowing the script to run again after an earlier build.
 *
 * This build does not clear dist first: existing files with matching names are
 * overwritten, but files removed from the source can remain in the output.
 * Use a clean dist directory when preparing a release after deleting files.
 */
await mkdir('dist/server',{recursive:true});
await mkdir('dist/.openai',{recursive:true});

/*
 * Copy the entire Worker source directory, preserving its module structure.
 * Sites loads server/index.js from the packaged output; its relative imports
 * resolve to api.js and page.js copied alongside it. The page is embedded in a
 * JavaScript module, so no separate frontend asset build is required.
 */
await cp('worker','dist/server',{recursive:true});

/*
 * Include the hosting manifest in the generated artifact. It identifies the
 * existing Sites project and declares the D1 database binding used by the API.
 * API keys belong in the host's runtime secrets, never in this manifest or the
 * generated application files. Copy the manifest unchanged to preserve identity.
 */
await copyFile('.openai/hosting.json','dist/.openai/hosting.json');

/*
 * Include the database migration files for the deployment workflow. They define
 * the slots and bookings tables and the partial unique index that prevents two
 * confirmed bookings for one slot. Copying SQL does not execute it or change a
 * database; the deployment process must apply the migrations separately.
 *
 * Each operation is awaited so a filesystem error rejects the script and makes
 * the build fail instead of reporting success with an incomplete artifact.
 */
await cp('drizzle','dist/drizzle',{recursive:true});
