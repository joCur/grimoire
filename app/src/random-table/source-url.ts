// The address a 5etools file is read from. A link to a file on GitHub's page
// (`github.com/<owner>/<repo>/blob/<ref>/<path>`) shows the page, not the
// file, so it is read from its raw address instead; any other address is
// taken as it is.

const GITHUB_BLOB = /^https?:\/\/github\.com\/([^/]+)\/([^/]+)\/blob\/(.+)$/;

export function sourceFileUrl(address: string): string {
  const url = address.trim();
  const blob = GITHUB_BLOB.exec(url);
  if (blob === null) return url;
  const [, owner, repo, rest] = blob;
  return `https://raw.githubusercontent.com/${owner}/${repo}/${rest}`;
}
