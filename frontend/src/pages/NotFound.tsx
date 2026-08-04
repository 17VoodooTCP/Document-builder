import { Link } from 'react-router-dom';

export default function NotFound() {
  return (
    <div className="flex min-h-full items-center justify-center px-4 py-24 text-center">
      <div>
        <h1 className="text-sm font-semibold uppercase tracking-wide text-slate-500">
          Nothing here
        </h1>
        <p className="mt-2 max-w-sm text-sm text-slate-600">
          If you arrived from a printed code, the link should look like
          {' '}<code className="font-mono text-xs">/verify/organisation/REFERENCE</code>{' '}
          — check it against the paper.
        </p>
        <Link
          to="/organisations"
          className="mt-6 inline-block text-sm font-medium text-slate-900 underline underline-offset-2"
        >
          Go to your organisations
        </Link>
      </div>
    </div>
  );
}
