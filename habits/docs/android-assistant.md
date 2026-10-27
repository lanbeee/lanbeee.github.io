# Android assistants: Gemini and Google Assistant

Tings exposes its existing assistant tools to Android agents through AppFunctions. The Android app also offers launcher shortcuts, deep links, and a plain-text Share target. These routes use the shared planner and confirmation screens; they do not need Ollama, a Gemini API key, or a second model inside Tings.

## Availability

As of October 26, 2026, Google describes Gemini's AppFunctions integration as a **private preview with trusted testers** ([Android AI overview](https://developer.android.com/ai)). Installing this build and enabling access does not make Tings appear in the public Gemini app automatically. Device support, an authorized agent, and Google's rollout are still required. Schema discovery, live read queries, and opening a write confirmation through the returned PendingIntent have been verified on a Pixel 7 Pro running Android 17. A connection from the Gemini app itself has not been verified.

AppFunctions require Android 16 / API 36 or later with platform support. On older Android versions the service is disabled; launcher shortcuts and sharing remain available. The browser PWA does not expose Android assistant controls or an external data endpoint.

Legacy Google Assistant App Actions declare opening features and searching Tings. Their availability depends on Google Assistant support and Play distribution/review ([App Actions setup](https://developer.android.com/develop/devices/assistant/get-started)). **Publishing the app does not automatically approve App Actions.** Accept the App Actions terms in Play Console's Advanced settings → App Actions, upload the build containing `shortcuts.xml`, and check the separate App Actions review status. App publication may complete while that review is still pending. App Actions approval also does not enroll an app in Gemini's private preview.

## Use on a phone

1. Install the rebuilt Android app and open it once.
2. In Settings, expand **Android assistant** and turn on **allow Android assistant access**. Read answers are shared with the authorized assistant you use.
3. On a supported device with agent access, ask it to use Tings, for example to list overdue tasks, show tomorrow's agenda, create a task, or mark an item done.
4. Open the returned action to review any proposed change. Tap the existing confirmation button in Tings to save. A `review_required` response means nothing has been saved.

Read queries use the live, loaded Tings WebView. If Android has closed it, the agent receives `open_required`: open Tings and retry the query. The phone must be unlocked. Turning access off immediately blocks subsequent reads and discards outstanding read results. Clearing app storage also revokes access.

Available without Gemini preview access:

- Long-press the Tings icon for **Today's plan** or **Add a task**. Assistant access is managed inside Tings Settings.
- Share plain text from another app to Tings to review it as a task title. Shared text is captured literally; it is not executed as an instruction.
- Open `tings://assistant/today`, `tings://assistant/add`, or `tings://assistant`.

## Tool contract

The generated AppFunctions service provides `getToolSchema`, `executeTool`, `getSchedule`, `searchItems`, `createTask`, and `completeItem`. `getToolSchema` returns the canonical JSON argument contract for all 13 exposed tools, or one named tool.

| Tools | Behavior |
|---|---|
| `answer_items`, `answer_schedule`, `answer_weather`, `answer_settings`, `lookup_item`, `find_item` | Return authoritative text from the shared tools after opt-in. |
| `draft_item`, `draft_setting`, `draft_batch`, `apply_items`, `complete_item`, `plan_item`, `delete_item` | Return an action that opens the normal confirmation preview in Tings. |

Each external call starts a fresh tool session. Use explicit saved titles and selectors; pronouns and `fromRecent` do not carry across calls. Use `draft_batch` for several new items and `apply_items` for a filtered set of edits. Schema validation rejects unknown tools, fields, and wrong argument types. Ambiguous matches retain the existing clarification behavior; the agent can ask the user and submit a new call with an exact title.

The response contains `status`, `text`, and an optional `openApp` PendingIntent. Statuses are `ok`, `review_required`, `open_required`, `disabled`, `unavailable`, `busy`, `timeout`, or `error`. Write results never claim a saved change. Public intents only open local UI; they cannot return planner data or commit a write. Read results are only returned through the system-permission-protected AppFunctions service.

## Development and verification

The shared slice is `js/assistant-external.js`. `scripts/build.mjs` in the Android wrapper derives `assistant-tool-catalog.json` from that allowlist and `js/assistant-schema.js`; there is no hand-maintained second schema. The native gateway, Capacitor plugin, and Kotlin service live under `android/app/src/main/java/io/github/lanbeee/tings/` in the wrapper.

The AppFunctions beta dependency requires compile SDK 37, AGP 9.1, and Gradle 9.3.1. The wrapper uses Kotlin 2.4.10, KSP 2.3.10, and JDK 21. Target SDK and minimum supported Android version are unchanged. The AGP compatibility flags in `android/gradle.properties` retain support for Capacitor's existing Gradle DSL.

From the wrapper:

```sh
npm run sync:android
npm run check
cd android
./gradlew :app:assembleDebug :app:testDebugUnitTest :app:lintDebug
```

On a connected device with AppFunctions support, install the debug APK and inspect registered functions:

```sh
adb install -r app/build/outputs/apk/debug/app-debug.apk
adb shell cmd app_function list-app-functions
adb shell "cmd app_function execute-app-function --package com.aretefoundry.tings --function 'io.github.lanbeee.tings.BaseTingsAppFunctionService#getToolSchema' --parameters '{}'"
adb shell "cmd app_function execute-app-function --package com.aretefoundry.tings --function 'io.github.lanbeee.tings.BaseTingsAppFunctionService#searchItems' --parameters '{}'"
adb shell "cmd app_function execute-app-function --package com.aretefoundry.tings --function 'io.github.lanbeee.tings.BaseTingsAppFunctionService#createTask' --parameters '{\"name\":\"Review test task\"}' --pending-intent-path 'property/androidAppfunctionsReturnValue.property/openApp'"
adb shell am start -a android.intent.action.VIEW -d 'tings://assistant/today' com.aretefoundry.tings
```

The `createTask` command opens a preview; dismiss it without saving to keep test data out of the planner. The PendingIntent path reflects the extras encoding used by AppFunctions beta01 and the Android 17 shell. Google also provides an [AppFunctions testing agent](https://github.com/android/appfunctions) for exercising returned actions; see the [integration verification guide](https://developer.android.com/ai/appfunctions/add-appfunctions). The shell checks do not enroll an app in Gemini's preview.

From the PWA directory, serve on port 4181 with `npx serve -l 4181 -s .`, then run `ASSISTANT_LIVE=0 ./run-tests.sh assistant`. `tests/assistant-external-test.js` exercises the actual shared tool and confirmation paths with a mocked native bridge and no model, including a launch arriving during an empty queue check. Native gateway tests cover opt-in, locking, bounded arguments, public intents, and unique immutable review actions. The Pixel smoke test additionally verified cold-open sharing, live reads, revocation, PendingIntent review handoff, and Android Back advancing a queued review; saved planner data and the original access preference were preserved. Testing through Gemini itself remains a separate integration check.
