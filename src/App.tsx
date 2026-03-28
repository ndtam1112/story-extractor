import React, { useState, useEffect } from 'react';
import { Download, Copy, Link as LinkIcon, Loader2, FileText, CheckCircle2, Table, LogOut } from 'lucide-react';

export default function App() {
  const [url, setUrl] = useState('');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<{ title: string; text: string; storyTitle?: string; chapterTitle?: string } | null>(null);
  const [error, setError] = useState('');
  const [copied, setCopied] = useState(false);
  
  // Google Sheets integration state
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [sheetUrl, setSheetUrl] = useState('');
  const [chapters, setChapters] = useState<{ title: string; url: string }[] | null>(null);
  const [fetchingChapters, setFetchingChapters] = useState(false);

  useEffect(() => {
    checkAuthStatus();

    const handleMessage = (event: MessageEvent) => {
      if (event.data?.type === 'OAUTH_AUTH_SUCCESS') {
        checkAuthStatus();
      }
    };
    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, []);

  const checkAuthStatus = async () => {
    try {
      const res = await fetch('/api/auth/status');
      const data = await res.json();
      setIsAuthenticated(data.isAuthenticated);
    } catch (err) {
      console.error('Failed to check auth status', err);
    }
  };

  const handleConnectGoogle = async () => {
    try {
      const redirectUri = `${window.location.origin}/auth/callback`;
      const res = await fetch(`/api/auth/url?redirectUri=${encodeURIComponent(redirectUri)}`);
      const data = await res.json();
      
      if (!res.ok) throw new Error(data.error || 'Failed to get auth URL');
      
      const authWindow = window.open(data.url, 'oauth_popup', 'width=600,height=700');
      if (!authWindow) {
        alert('Please allow popups for this site to connect your account.');
      }
    } catch (err: any) {
      setError(err.message || 'Failed to connect to Google');
    }
  };

  const handleLogout = async () => {
    try {
      await fetch('/api/auth/logout', { method: 'POST' });
      setIsAuthenticated(false);
      setSheetUrl('');
    } catch (err) {
      console.error('Failed to logout', err);
    }
  };

  const handleExportToSheets = async () => {
    if (!result) return;
    
    setExporting(true);
    setError('');
    setSheetUrl('');
    
    try {
      const res = await fetch('/api/export-to-sheets', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          title: result.chapterTitle || result.title, 
          text: result.text,
          storyTitle: result.storyTitle 
        })
      });
      
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to export');
      
      setSheetUrl(data.url);
    } catch (err: any) {
      setError(err.message || 'Failed to export to Google Sheets');
    } finally {
      setExporting(false);
    }
  };

  const handleFetch = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!url.trim()) return;

    setLoading(true);
    setError('');
    setResult(null);
    setCopied(false);
    setSheetUrl('');

    try {
      const response = await fetch('/api/fetch-story', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ url: url.trim() }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Failed to fetch content');
      }

      setResult(data);
    } catch (err: any) {
      setError(err.message || 'An unexpected error occurred');
    } finally {
      setLoading(false);
    }
  };

  const handleFetchChapters = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!url.trim()) return;

    setFetchingChapters(true);
    setError('');
    setChapters(null);
    setResult(null);
    setSheetUrl('');

    try {
      const response = await fetch('/api/fetch-chapters', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ url: url.trim() }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Failed to fetch chapters');
      }

      setChapters(data.chapters);
      if (data.storyTitle && !result) {
        setResult({ title: data.storyTitle, text: '', storyTitle: data.storyTitle });
      }
    } catch (err: any) {
      setError(err.message || 'An unexpected error occurred while fetching chapters');
    } finally {
      setFetchingChapters(false);
    }
  };

  const handleSelectChapter = async (chapterUrl: string) => {
    setUrl(chapterUrl);
    // Automatically fetch chapter content
    setLoading(true);
    setError('');
    setResult(null);
    setCopied(false);
    setSheetUrl('');

    try {
      const response = await fetch('/api/fetch-story', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ url: chapterUrl }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Failed to fetch content');
      }

      setResult(data);
      // Scroll to result
      setTimeout(() => {
        document.getElementById('result-section')?.scrollIntoView({ behavior: 'smooth' });
      }, 100);
    } catch (err: any) {
      setError(err.message || 'An unexpected error occurred');
    } finally {
      setLoading(false);
    }
  };

  const handleCopy = async () => {
    if (!result?.text) return;
    try {
      await navigator.clipboard.writeText(result.text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error('Failed to copy text: ', err);
    }
  };

  const handleDownload = () => {
    if (!result?.text) return;
    const blob = new Blob([result.text], { type: 'text/plain;charset=utf-8' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    const safeTitle = result.title.replace(/[^a-z0-9]/gi, '_').toLowerCase() || 'story';
    link.download = `${safeTitle}.txt`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(link.href);
  };

  return (
    <div className="min-h-screen bg-neutral-50 text-neutral-900 font-sans p-4 md:p-8">
      <div className="max-w-4xl mx-auto space-y-8">
        
        {/* Header */}
        <header className="text-center space-y-2 relative">
          <div className="absolute top-0 right-0">
            {isAuthenticated ? (
              <div className="flex items-center gap-3 text-sm">
                <span className="text-green-600 font-medium flex items-center gap-1">
                  <CheckCircle2 size={16} /> Google Connected
                </span>
                <button onClick={handleLogout} className="text-neutral-500 hover:text-neutral-700 flex items-center gap-1">
                  <LogOut size={16} /> Disconnect
                </button>
              </div>
            ) : (
              <button 
                onClick={handleConnectGoogle}
                className="text-sm font-medium text-blue-600 hover:text-blue-700 flex items-center gap-1 bg-blue-50 px-3 py-1.5 rounded-lg transition-colors"
              >
                <Table size={16} /> Connect Google Sheets
              </button>
            )}
          </div>
          
          <div className="inline-flex items-center justify-center p-3 bg-blue-100 text-blue-600 rounded-full mb-4 mt-8 md:mt-0">
            <FileText size={32} />
          </div>
          <h1 className="text-3xl md:text-4xl font-bold tracking-tight">Story Extractor</h1>
          <p className="text-neutral-500 max-w-lg mx-auto">
            Extract text from story websites bypassing copy blocks. Export to .txt or directly to your Google Sheets.
          </p>
        </header>

        {/* Input Section */}
        <div className="bg-white rounded-2xl shadow-sm border border-neutral-200 p-6">
          <form onSubmit={handleFetch} className="space-y-4">
            <div>
              <label htmlFor="url" className="block text-sm font-medium text-neutral-700 mb-1">
                Story URL
              </label>
              <div className="relative">
                <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                  <LinkIcon className="h-5 w-5 text-neutral-400" />
                </div>
                <input
                  type="url"
                  id="url"
                  required
                  placeholder="https://vivutruyen2.net/..."
                  className="block w-full pl-10 pr-4 py-3 border border-neutral-300 rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-colors"
                  value={url}
                  onChange={(e) => setUrl(e.target.value)}
                  disabled={loading}
                />
              </div>
            </div>
            
            <div className="flex gap-3">
              <button
                type="submit"
                disabled={loading || fetchingChapters || !url.trim()}
                className="flex-1 flex items-center justify-center py-3 px-4 border border-transparent rounded-xl shadow-sm text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                onClick={handleFetch}
              >
                {loading ? (
                  <>
                    <Loader2 className="animate-spin -ml-1 mr-2 h-5 w-5" />
                    Extracting...
                  </>
                ) : (
                  'Extract Content'
                )}
              </button>
              
              <button
                type="button"
                disabled={loading || fetchingChapters || !url.trim()}
                className="flex-1 flex items-center justify-center py-3 px-4 border border-neutral-300 rounded-xl shadow-sm text-sm font-medium text-neutral-700 bg-white hover:bg-neutral-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                onClick={handleFetchChapters}
              >
                {fetchingChapters ? (
                  <>
                    <Loader2 className="animate-spin -ml-1 mr-2 h-5 w-5" />
                    Fetching Chapters...
                  </>
                ) : (
                  'List Chapters'
                )}
              </button>
            </div>
          </form>
          
          {error && (
            <div className="mt-4 p-4 bg-red-50 border border-red-200 text-red-700 rounded-xl text-sm">
              {error}
            </div>
          )}
          
          {sheetUrl && (
            <div className="mt-4 p-4 bg-green-50 border border-green-200 text-green-800 rounded-xl text-sm flex items-center justify-between">
              <div className="flex items-center gap-2">
                <CheckCircle2 className="h-5 w-5 text-green-600" />
                <span>Successfully exported to Google Sheets!</span>
              </div>
              <a 
                href={sheetUrl} 
                target="_blank" 
                rel="noopener noreferrer"
                className="font-medium text-green-700 hover:text-green-900 underline"
              >
                Open Sheet
              </a>
            </div>
          )}
        </div>

        {/* Chapters Section */}
        {chapters && (
          <div className="bg-white rounded-2xl shadow-sm border border-neutral-200 overflow-hidden">
            <div className="p-4 border-b border-neutral-200 bg-neutral-50">
              <h2 className="font-semibold text-neutral-800">Available Chapters ({chapters.length})</h2>
            </div>
            <div className="max-h-64 overflow-y-auto p-2">
              <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-2">
                {chapters.map((chapter, index) => (
                  <button
                    key={index}
                    onClick={() => handleSelectChapter(chapter.url)}
                    className="text-left px-3 py-2 text-sm rounded-lg hover:bg-blue-50 hover:text-blue-600 transition-colors truncate border border-transparent hover:border-blue-100"
                    title={chapter.title}
                  >
                    {chapter.title}
                  </button>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* Result Section */}
        {result && result.text && (
          <div id="result-section" className="bg-white rounded-2xl shadow-sm border border-neutral-200 overflow-hidden flex flex-col">
            <div className="p-4 border-b border-neutral-200 bg-neutral-50 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
              <div className="flex flex-col min-w-0">
                <h2 className="font-semibold text-neutral-800 truncate" title={result.storyTitle}>
                  {result.storyTitle || 'Extracted Content'}
                </h2>
                <p className="text-sm text-neutral-500 truncate" title={result.chapterTitle}>
                  {result.chapterTitle || result.title}
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-2 shrink-0">
                {isAuthenticated ? (
                  <button
                    onClick={handleExportToSheets}
                    disabled={exporting}
                    className="inline-flex items-center px-3 py-1.5 border border-transparent shadow-sm text-sm font-medium rounded-lg text-white bg-green-600 hover:bg-green-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-green-500 transition-colors disabled:opacity-50"
                  >
                    {exporting ? (
                      <><Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> Exporting...</>
                    ) : (
                      <><Table className="mr-1.5 h-4 w-4" /> Export to Sheets</>
                    )}
                  </button>
                ) : (
                  <button
                    onClick={handleConnectGoogle}
                    className="inline-flex items-center px-3 py-1.5 border border-neutral-300 shadow-sm text-sm font-medium rounded-lg text-neutral-700 bg-white hover:bg-neutral-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 transition-colors"
                  >
                    <Table className="mr-1.5 h-4 w-4 text-green-600" /> Connect Sheets
                  </button>
                )}
                
                <button
                  onClick={handleCopy}
                  className="inline-flex items-center px-3 py-1.5 border border-neutral-300 shadow-sm text-sm font-medium rounded-lg text-neutral-700 bg-white hover:bg-neutral-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 transition-colors"
                >
                  {copied ? (
                    <><CheckCircle2 className="mr-1.5 h-4 w-4 text-green-500" /> Copied</>
                  ) : (
                    <><Copy className="mr-1.5 h-4 w-4" /> Copy Text</>
                  )}
                </button>
                <button
                  onClick={handleDownload}
                  className="inline-flex items-center px-3 py-1.5 border border-transparent shadow-sm text-sm font-medium rounded-lg text-white bg-neutral-800 hover:bg-neutral-900 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-neutral-900 transition-colors"
                >
                  <Download className="mr-1.5 h-4 w-4" />
                  Save .txt
                </button>
              </div>
            </div>
            
            <div className="p-0 relative group flex-grow">
              <textarea
                readOnly
                className="w-full h-[500px] p-6 resize-none focus:outline-none text-neutral-700 leading-relaxed font-serif"
                value={result.text}
              />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
