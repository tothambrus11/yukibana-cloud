<script lang="ts">
  /** A button that puts `text` on the clipboard and says whether it did.
   *  Where the clipboard is out of reach (an insecure origin, a denied
   *  permission) it says so, and the text stays on screen beside it to be
   *  selected by hand. */
  let { text, label = 'Copy details' }: { text: string; label?: string } = $props();
  let said = $state('');

  async function copy(): Promise<void> {
    try {
      await navigator.clipboard.writeText(text);
      said = 'Copied';
    } catch {
      said = 'Could not copy; select the text instead';
    }
    setTimeout(() => (said = ''), 3000);
  }
</script>

<button type="button" class="quiet" onclick={copy}>{said === '' ? label : said}</button>
