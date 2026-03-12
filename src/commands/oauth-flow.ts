import type { RuntimeEnv } from "../runtime.js";
import type { WizardPrompter } from "../wizard/prompts.js";

type OAuthPrompt = { message: string; placeholder?: string };

const validateRequiredInput = (value: string) => (value.trim().length > 0 ? undefined : "Required");

export function createVpsAwareOAuthHandlers(params: {
  isRemote: boolean;
  prompter: WizardPrompter;
  runtime: RuntimeEnv;
  spin: ReturnType<WizardPrompter["progress"]>;
  openUrl: (url: string) => Promise<unknown>;
  localBrowserMessage: string;
  manualPromptMessage?: string;
}): {
  onAuth: (event: { url: string; instructions?: string }) => Promise<void>;
  onPrompt: (prompt: OAuthPrompt) => Promise<string>;
  onManualCodeInput: () => Promise<string>;
} {
  const manualPromptMessage = params.manualPromptMessage ?? "Paste the redirect URL";
  // Shared promise so both onManualCodeInput and onPrompt fallback use the same input.
  let manualCodePromise: Promise<string> | undefined;

  const startManualPrompt = (): Promise<string> => {
    if (!manualCodePromise) {
      manualCodePromise = params.prompter
        .text({
          message: manualPromptMessage,
          validate: validateRequiredInput,
        })
        .then((value) => String(value));
    }
    return manualCodePromise;
  };

  return {
    onAuth: async ({ url }) => {
      if (params.isRemote) {
        params.spin.stop("OAuth URL ready");
        params.runtime.log(`\nOpen this URL in your LOCAL browser:\n\n${url}\n`);
        // onManualCodeInput will start the prompt immediately after onAuth returns.
        return;
      }

      params.spin.update(params.localBrowserMessage);
      await params.openUrl(url);
      params.runtime.log(`Open: ${url}`);
    },
    // onManualCodeInput races with the local callback server — whichever resolves first wins.
    // This eliminates the 60-second wait when the automatic browser callback doesn't arrive.
    onManualCodeInput: () => startManualPrompt(),
    onPrompt: async (prompt) => {
      // Fallback: reuse any already-started manual prompt, or start a fresh one.
      if (manualCodePromise) {
        return manualCodePromise;
      }
      const code = await params.prompter.text({
        message: prompt.message,
        placeholder: prompt.placeholder,
        validate: validateRequiredInput,
      });
      return String(code);
    },
  };
}
