/**
 * Monaco's editor features this page shows a language server's answers
 * in, and the grammars of its languages, each imported for its side
 * effect. The bare `editor.api` has none of them: without the hover
 * contribution a binding's hover provider is never asked, without the
 * suggest controller completion never opens. The list is Light's app's
 * (app/src/lib/monaco.ts), less what only the app shows. Monaco's own
 * TypeScript service is not imported: the JavaScript pack's server answers
 * for JavaScript and TypeScript, and two providers would show every
 * completion twice.
 */
import 'monaco-editor/features/codicon/register';
import 'monaco-editor/editor/browser/coreCommands';
import 'monaco-editor/editor/browser/widget/codeEditor/codeEditorWidget';
import 'monaco-editor/editor/contrib/bracketMatching/browser/bracketMatching';
import 'monaco-editor/editor/contrib/clipboard/browser/clipboard';
import 'monaco-editor/editor/contrib/codeAction/browser/codeActionContributions';
import 'monaco-editor/editor/contrib/codelens/browser/codelensController';
import 'monaco-editor/editor/contrib/comment/browser/comment';
import 'monaco-editor/editor/contrib/contextmenu/browser/contextmenu';
import 'monaco-editor/editor/contrib/documentSymbols/browser/documentSymbols';
import 'monaco-editor/editor/contrib/find/browser/findController';
import 'monaco-editor/editor/contrib/folding/browser/folding';
import 'monaco-editor/editor/contrib/format/browser/formatActions';
import 'monaco-editor/editor/contrib/gotoError/browser/gotoError';
import 'monaco-editor/editor/contrib/gotoSymbol/browser/goToCommands';
import 'monaco-editor/editor/contrib/gotoSymbol/browser/link/goToDefinitionAtPosition';
import 'monaco-editor/editor/contrib/hover/browser/hoverContribution';
import 'monaco-editor/editor/contrib/inlayHints/browser/inlayHintsContribution';
import 'monaco-editor/editor/contrib/links/browser/links';
import 'monaco-editor/editor/contrib/parameterHints/browser/parameterHints';
import 'monaco-editor/editor/contrib/rename/browser/rename';
import 'monaco-editor/editor/contrib/semanticTokens/browser/documentSemanticTokens';
import 'monaco-editor/editor/contrib/semanticTokens/browser/viewportSemanticTokens';
import 'monaco-editor/editor/contrib/smartSelect/browser/smartSelect';
import 'monaco-editor/editor/contrib/snippet/browser/snippetController2';
import 'monaco-editor/editor/contrib/suggest/browser/suggestController';
import 'monaco-editor/editor/contrib/wordHighlighter/browser/wordHighlighter';
import 'monaco-editor/editor/standalone/browser/quickAccess/standaloneCommandsQuickAccess';
import 'monaco-editor/editor/standalone/browser/quickAccess/standaloneGotoSymbolQuickAccess';
import 'monaco-editor/editor/standalone/browser/referenceSearch/standaloneReferenceSearch';
import 'monaco-editor/languages/definitions/python/register';
import 'monaco-editor/languages/definitions/cpp/register';
import 'monaco-editor/languages/definitions/rust/register';
import 'monaco-editor/languages/definitions/go/register';
import 'monaco-editor/languages/definitions/javascript/register';
import 'monaco-editor/languages/definitions/typescript/register';
