# NotchMine search helper
# A small process that answers the search box (Ctrl+Alt+Space). It waits on stdin, so it costs no CPU between
# searches, and main.js stops it after a few idle minutes. One request per line, tab-separated:
#   IN : <id> \t status            → is Everything running?
#        <id> \t files \t <query>  → files and folders (Everything if it runs, else the Windows search index)
#        <id> \t apps              → every app in Start (name + app ID)
#        <id> \t appicon \t <ID>   → that app's icon as Start shows it (PNG, base64)
#   OUT: {"id":"<id>","data":<json>}  or  {"id":"<id>","error":"…"}
# Everything (voidtools.com) is free and finds files by name instantly; its SDK dll ships in bridge\everything.

$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

$arch = $env:PROCESSOR_ARCHITECTURE
$dllName = if ($arch -eq 'ARM64') { 'EverythingARM64.dll' } elseif ([Environment]::Is64BitProcess) { 'Everything64.dll' } else { '' }
$dllPath = if ($dllName) { Join-Path $PSScriptRoot "everything\$dllName" } else { '' }

$src = @'
using System;
using System.Text;
using System.Collections.Generic;
using System.Runtime.InteropServices;

namespace NotchSearch {
  public static class J {
    public static string S(string s) {
      if (s == null) return "\"\"";
      var b = new StringBuilder(s.Length + 8);
      b.Append('"');
      foreach (char c in s) {
        switch (c) {
          case '"': b.Append("\\\""); break;
          case '\\': b.Append("\\\\"); break;
          case '\n': b.Append("\\n"); break;
          case '\r': b.Append("\\r"); break;
          case '\t': b.Append("\\t"); break;
          default: if (c < 0x20) b.Append("\\u").Append(((int)c).ToString("x4")); else b.Append(c); break;
        }
      }
      b.Append('"');
      return b.ToString();
    }
    public static long UnixMs(DateTime utc) { return (long)(utc - new DateTime(1970, 1, 1, 0, 0, 0, DateTimeKind.Utc)).TotalMilliseconds; }
  }

  // ---- Everything (voidtools) through its SDK dll. The dll talks to the running Everything over a window message.
  public static class Ev {
    [DllImport("kernel32.dll", CharSet = CharSet.Unicode)] static extern IntPtr LoadLibraryW(string p);
    [DllImport("__EVDLL__", CharSet = CharSet.Unicode)] static extern void Everything_SetSearchW(string s);
    [DllImport("__EVDLL__")] static extern void Everything_SetMax(uint n);
    [DllImport("__EVDLL__")] static extern void Everything_SetSort(uint s);
    [DllImport("__EVDLL__")] static extern void Everything_SetRequestFlags(uint f);
    [DllImport("__EVDLL__")] static extern void Everything_SetMatchPath(bool b);
    [DllImport("__EVDLL__")] static extern bool Everything_QueryW(bool wait);
    [DllImport("__EVDLL__")] static extern uint Everything_GetNumResults();
    [DllImport("__EVDLL__")] static extern uint Everything_GetLastError();
    [DllImport("__EVDLL__")] static extern bool Everything_IsFolderResult(uint i);
    [DllImport("__EVDLL__")] static extern IntPtr Everything_GetResultFileNameW(uint i);
    [DllImport("__EVDLL__")] static extern IntPtr Everything_GetResultPathW(uint i);
    [DllImport("__EVDLL__")] static extern bool Everything_GetResultDateModified(uint i, out long ft);
    [DllImport("__EVDLL__")] static extern bool Everything_GetResultSize(uint i, out long size);
    [DllImport("__EVDLL__")] static extern uint Everything_GetMajorVersion();
    [DllImport("__EVDLL__")] static extern uint Everything_GetMinorVersion();
    [DllImport("__EVDLL__")] static extern uint Everything_GetRevision();
    [DllImport("__EVDLL__")] static extern bool Everything_IsDBLoaded();
    [DllImport("__EVDLL__")] static extern void Everything_Reset();

    static bool loaded;
    public static bool Load(string path) {
      if (loaded) return true;
      if (string.IsNullOrEmpty(path)) return false;
      loaded = LoadLibraryW(path) != IntPtr.Zero;
      return loaded;
    }
    public static bool Running() {
      if (!loaded) return false;
      try { return Everything_GetMajorVersion() > 0; } catch { return false; }
    }
    public static string Status() {
      if (!loaded) return "{\"running\":false,\"dll\":false}";
      uint maj = 0, min = 0, rev = 0; bool db = false;
      try { maj = Everything_GetMajorVersion(); if (maj > 0) { min = Everything_GetMinorVersion(); rev = Everything_GetRevision(); db = Everything_IsDBLoaded(); } } catch { }
      return "{\"running\":" + (maj > 0 ? "true" : "false") + ",\"dll\":true,\"version\":" + J.S(maj > 0 ? maj + "." + min + "." + rev : "") + ",\"db\":" + (db ? "true" : "false") + "}";
    }

    const uint FLAGS = 0x1 | 0x2 | 0x10 | 0x40;      // file name, path, size, date modified
    const uint SORT_DATE_MODIFIED_DESC = 14;

    // one Everything query → items appended to the list (skipping paths already there). False = Everything is not answering.
    static bool Run(string search, uint max, List<string> outItems, HashSet<string> seen) {
      Everything_Reset();
      Everything_SetSearchW(search);
      Everything_SetMatchPath(false);
      Everything_SetMax(max);
      Everything_SetSort(SORT_DATE_MODIFIED_DESC);
      Everything_SetRequestFlags(FLAGS);
      if (!Everything_QueryW(true)) return false;
      uint n = Everything_GetNumResults();
      for (uint i = 0; i < n; i++) {
        string name = Marshal.PtrToStringUni(Everything_GetResultFileNameW(i)) ?? "";
        string dir = Marshal.PtrToStringUni(Everything_GetResultPathW(i)) ?? "";
        string full = dir.Length == 0 ? name : (dir.EndsWith("\\") ? dir + name : dir + "\\" + name);
        if (!seen.Add(full.ToLowerInvariant())) continue;
        bool folder = Everything_IsFolderResult(i);
        long ft, size;
        long mtime = 0;
        if (Everything_GetResultDateModified(i, out ft) && ft > 0 && ft != -1) { try { mtime = J.UnixMs(DateTime.FromFileTimeUtc(ft)); } catch { } }
        if (!Everything_GetResultSize(i, out size)) size = -1;
        outItems.Add("{\"name\":" + J.S(name) + ",\"dir\":" + J.S(dir) + ",\"path\":" + J.S(full) + ",\"folder\":" + (folder ? "true" : "false") +
                     ",\"mtime\":" + mtime + ",\"size\":" + size + "}");
      }
      return true;
    }

    // what nobody looks for: temp files, Windows' own folders, the recycle bin, package caches
    static string Exclusions() {
      string win = Environment.GetFolderPath(Environment.SpecialFolder.Windows);
      var b = new StringBuilder();
      if (!string.IsNullOrEmpty(win)) b.Append(" !\"").Append(win.TrimEnd('\\')).Append("\\\"");
      string[] junk = {
        @"\AppData\Local\Temp\", @"\$Recycle.Bin\", @"\node_modules\", @"\.git\", @"\AppData\Local\Packages\",
        @"\AppData\Local\Microsoft\", @"\AppData\Roaming\Microsoft\Windows\Recent\", @"\System Volume Information\",
        // package and tool folders: thousands of files with ordinary names ("project", "config") that drown out yours
        @"\.venv\", @"\venv\", @"\site-packages\", @"\__pycache__\", @"\WindowsApps\", @"\.vscode\extensions\",
        @"\miniconda3\", @"\anaconda3\", @"\.cache\", @"\.nuget\", @"\.gradle\", @"\.cargo\", @"\.rustup\"
      };
      foreach (string j in junk) b.Append(" !\"").Append(j).Append('"');
      return b.ToString();
    }

    // files and folders for the search box: names that start with the first word first (newest first), then any match
    public static string Files(string q) {
      if (!Running()) return null;
      var items = new List<string>();
      var seen = new HashSet<string>();
      string ex = Exclusions();
      string t = q.Trim();
      bool syntax = t.IndexOfAny(new[] { ':', '\\', '*', '?', '|', '<', '>', '"', '!' }) >= 0;   // the user typed Everything's own syntax
      if (!syntax) {
        string[] w = t.Split(new[] { ' ' }, StringSplitOptions.RemoveEmptyEntries);
        if (w.Length > 0) {
          string rest = w.Length > 1 ? " " + string.Join(" ", w, 1, w.Length - 1) : "";
          // folders first: there are far fewer of them, so an old one like D:\Projects isn't pushed out by newer files
          if (!Run("folder: startwith:\"" + w[0] + "\"" + rest + ex, 25, items, seen)) return null;
          Run("startwith:\"" + w[0] + "\"" + rest + ex, 30, items, seen);
        }
      }
      if (!Run(t + (syntax ? "" : ex), 40, items, seen) && items.Count == 0) return null;
      return "{\"engine\":\"everything\",\"items\":[" + string.Join(",", items) + "]}";
    }
  }

  // ---- fallback: the Windows search index (only the folders Windows indexes; slower, but always there)
  public static class Ws {
    public static string Files(string q, int max) {
      var items = new List<string>();
      var seen = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
      try { Index(q, max, items, seen); } catch { }
      Walk.Start();
      Walk.Query(q, 40, items, seen);
      return "{\"engine\":\"windows\",\"items\":[" + string.Join(",", items) + "]}";
    }
    static void Index(string q, int max, List<string> items, HashSet<string> seen) {
      var words = new List<string>();
      var exts = new List<string>();
      foreach (string raw in q.Split(new[] { ' ' }, StringSplitOptions.RemoveEmptyEntries)) {
        bool ext = raw.StartsWith("ext:", StringComparison.OrdinalIgnoreCase);   // Everything's ext:pdf (or ext:jpg;png)
        var b = new StringBuilder();
        foreach (char c in ext ? raw.Substring(4) : raw) if (char.IsLetterOrDigit(c) || c == '.' || c == '-' || c == '_' || (ext && c == ';')) b.Append(c);
        if (b.Length == 0) continue;
        if (ext) { foreach (string e in b.ToString().Split(';')) if (e.Trim('.').Length > 0) exts.Add("System.FileExtension = '." + e.Trim('.') + "'"); }
        else words.Add("\"" + b + "*\"");
      }
      if (words.Count == 0 && exts.Count == 0) return;
      var where = new List<string> { "SCOPE='file:'" };
      if (words.Count > 0) where.Add("CONTAINS(System.FileName, '" + string.Join(" AND ", words) + "')");
      if (exts.Count > 0) where.Add("(" + string.Join(" OR ", exts) + ")");
      string sql = "SELECT TOP " + max + " System.ItemPathDisplay, System.FileName, System.DateModified, System.Size, System.ItemType FROM SystemIndex " +
                   "WHERE " + string.Join(" AND ", where) + " ORDER BY System.DateModified DESC";
      using (var con = new System.Data.OleDb.OleDbConnection("Provider=Search.CollatorDSO;Extended Properties='Application=Windows';")) {
        con.Open();
        using (var cmd = new System.Data.OleDb.OleDbCommand(sql, con))
        using (var r = cmd.ExecuteReader()) {
          while (r.Read()) {
            string full = r.IsDBNull(0) ? "" : Convert.ToString(r.GetValue(0));
            if (full.Length == 0 || !seen.Add(full)) continue;
            string name = r.IsDBNull(1) ? System.IO.Path.GetFileName(full) : Convert.ToString(r.GetValue(1));
            string dir = System.IO.Path.GetDirectoryName(full) ?? "";
            long mtime = 0;
            if (!r.IsDBNull(2)) { try { mtime = J.UnixMs(Convert.ToDateTime(r.GetValue(2)).ToUniversalTime()); } catch { } }
            long size = -1;
            if (!r.IsDBNull(3)) { try { size = Convert.ToInt64(r.GetValue(3)); } catch { } }
            string type = r.IsDBNull(4) ? "" : Convert.ToString(r.GetValue(4));
            bool folder = type.Equals("Directory", StringComparison.OrdinalIgnoreCase) || type.Equals("File folder", StringComparison.OrdinalIgnoreCase);
            items.Add("{\"name\":" + J.S(name) + ",\"dir\":" + J.S(dir) + ",\"path\":" + J.S(full) + ",\"folder\":" + (folder ? "true" : "false") +
                      ",\"mtime\":" + mtime + ",\"size\":" + size + "}");
          }
        }
      }
    }
  }

  // ---- without Everything: a list of file names on the drives the Windows index doesn't cover (other drives, and
  // folders at the top of the system drive), built once in the background and refreshed every 10 minutes.
  public static class Walk {
    struct E { public string Name; public int Dir; public bool Folder; public long Mtime; }
    static readonly object gate = new object();
    static List<E> entries = new List<E>();
    static List<string> dirs = new List<string>();
    static volatile bool building;
    static DateTime builtAt = DateTime.MinValue;
    const int MAX = 300000;                       // names kept (about 20 MB at most)
    static readonly TimeSpan BUDGET = TimeSpan.FromSeconds(20);
    // folders full of files nobody looks for by name
    static readonly HashSet<string> SKIP = new HashSet<string>(StringComparer.OrdinalIgnoreCase) {
      "node_modules", ".git", ".svn", ".hg", "$Recycle.Bin", "System Volume Information", "$WinREAgent", "$SysReset", "Config.Msi",
      "site-packages", "dist-packages", "__pycache__", ".venv", "venv", ".cache", ".gradle", ".nuget", ".m2", ".cargo", ".npm",
      "obj", ".vs", ".idea", "pkgs", "WindowsApps", "bower_components", "vendor"
    };
    // the system drive's own folders (the Windows index covers the user folders; the rest is Windows and programs)
    static readonly HashSet<string> SYSTEM_TOP = new HashSet<string>(StringComparer.OrdinalIgnoreCase) {
      "Windows", "Program Files", "Program Files (x86)", "ProgramData", "Users", "Recovery", "PerfLogs", "Documents and Settings",
      "MSOCache", "OneDriveTemp", "Intel", "AMD", "NVIDIA", "Drivers", "inetpub", "ESD", "Windows.old", "XboxGames"
    };

    public static void Start() {
      if (building || DateTime.UtcNow - builtAt < TimeSpan.FromMinutes(10)) return;
      building = true;
      var t = new System.Threading.Thread(Build);
      t.IsBackground = true;
      t.Priority = System.Threading.ThreadPriority.BelowNormal;
      t.Start();
    }

    static void Build() {
      var es = new List<E>();
      var ds = new List<string>();
      var queue = new Queue<KeyValuePair<string, int>>();
      try {
        string sysRoot = System.IO.Path.GetPathRoot(Environment.GetFolderPath(Environment.SpecialFolder.Windows)) ?? "C:\\";
        foreach (var d in System.IO.DriveInfo.GetDrives()) {
          try {
            if (d.DriveType != System.IO.DriveType.Fixed || !d.IsReady) continue;
            string root = d.RootDirectory.FullName;
            if (!root.Equals(sysRoot, StringComparison.OrdinalIgnoreCase)) { queue.Enqueue(new KeyValuePair<string, int>(root, 0)); continue; }
            foreach (var top in new System.IO.DirectoryInfo(root).EnumerateDirectories()) {
              if (SYSTEM_TOP.Contains(top.Name) || SKIP.Contains(top.Name) || top.Name.StartsWith("$")) continue;
              if ((top.Attributes & (System.IO.FileAttributes.Hidden | System.IO.FileAttributes.System)) != 0) continue;
              queue.Enqueue(new KeyValuePair<string, int>(top.FullName, 1));
            }
          } catch { }
        }
        var started = DateTime.UtcNow;
        while (queue.Count > 0 && es.Count < MAX && DateTime.UtcNow - started < BUDGET) {
          var cur = queue.Dequeue();
          int di = ds.Count;
          ds.Add(cur.Key.TrimEnd('\\'));
          IEnumerable<System.IO.FileSystemInfo> list;
          try { list = new System.IO.DirectoryInfo(cur.Key).EnumerateFileSystemInfos(); } catch { continue; }
          try {
            foreach (var f in list) {
              var a = f.Attributes;
              if ((a & (System.IO.FileAttributes.Hidden | System.IO.FileAttributes.System)) != 0) continue;
              bool folder = (a & System.IO.FileAttributes.Directory) != 0;
              long mt = 0;
              try { mt = J.UnixMs(f.LastWriteTimeUtc); } catch { }
              es.Add(new E { Name = f.Name, Dir = di, Folder = folder, Mtime = mt });
              if (folder && cur.Value < 14 && !SKIP.Contains(f.Name) && (a & System.IO.FileAttributes.ReparsePoint) == 0)
                queue.Enqueue(new KeyValuePair<string, int>(f.FullName, cur.Value + 1));
              if (es.Count >= MAX) break;
            }
          } catch { }
        }
      } catch { }
      lock (gate) { entries = es; dirs = ds; }
      builtAt = DateTime.UtcNow;
      building = false;
    }

    // names that contain every word (any case), names starting with the first word first, then the newest
    public static void Query(string q, int max, List<string> items, HashSet<string> seen) {
      var words = new List<string>();
      var exts = new List<string>();
      foreach (string w in q.Split(new[] { ' ' }, StringSplitOptions.RemoveEmptyEntries)) {
        if (w.StartsWith("ext:", StringComparison.OrdinalIgnoreCase)) { foreach (string e in w.Substring(4).Split(';')) if (e.Trim('.').Length > 0) exts.Add("." + e.Trim('.')); }
        else words.Add(w);
      }
      if (words.Count == 0 && exts.Count == 0) return;
      List<E> es; List<string> ds;
      lock (gate) { es = entries; ds = dirs; }
      var hits = new List<int>();
      for (int i = 0; i < es.Count && hits.Count < 3000; i++) {
        string n = es[i].Name;
        bool ok = true;
        foreach (string w in words) if (n.IndexOf(w, StringComparison.OrdinalIgnoreCase) < 0) { ok = false; break; }
        if (ok && exts.Count > 0) {
          ok = false;
          foreach (string e in exts) if (n.EndsWith(e, StringComparison.OrdinalIgnoreCase)) { ok = true; break; }
        }
        if (ok) hits.Add(i);
      }
      string first = words.Count > 0 ? words[0] : "";
      hits.Sort((x, y) => {
        int px = first.Length > 0 && es[x].Name.StartsWith(first, StringComparison.OrdinalIgnoreCase) ? 0 : 1;
        int py = first.Length > 0 && es[y].Name.StartsWith(first, StringComparison.OrdinalIgnoreCase) ? 0 : 1;
        return px != py ? px - py : es[y].Mtime.CompareTo(es[x].Mtime);
      });
      int added = 0;
      foreach (int i in hits) {
        if (added >= max) break;
        var e = es[i];
        string dir = ds[e.Dir];
        string full = dir + "\\" + e.Name;
        if (!seen.Add(full)) continue;
        added++;
        items.Add("{\"name\":" + J.S(e.Name) + ",\"dir\":" + J.S(dir) + ",\"path\":" + J.S(full) + ",\"folder\":" + (e.Folder ? "true" : "false") +
                  ",\"mtime\":" + e.Mtime + ",\"size\":-1}");
      }
    }
  }

  // ---- an app's icon by its app ID, as Start shows it (keeps the transparency)
  [StructLayout(LayoutKind.Sequential)] public struct IconSize { public int cx, cy; }
  [ComImport, Guid("bcc18b79-ba16-442f-80c4-8a59c30c463b"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  public interface IImageFactory { [PreserveSig] int GetImage(IconSize size, int flags, out IntPtr hbm); }
  public static class Icons {
    [DllImport("shell32.dll", CharSet = CharSet.Unicode)] static extern int SHCreateItemFromParsingName(string path, IntPtr pbc, ref Guid riid, [MarshalAs(UnmanagedType.Interface)] out IImageFactory item);
    [DllImport("gdi32.dll")] static extern bool DeleteObject(IntPtr h);
    public static string App(string aumid, int size) {
      try {
        Guid iid = typeof(IImageFactory).GUID; IImageFactory f;
        if (SHCreateItemFromParsingName("shell:AppsFolder\\" + aumid, IntPtr.Zero, ref iid, out f) != 0 || f == null) return "";
        try {
          IntPtr hbm; var sz = new IconSize(); sz.cx = size; sz.cy = size;
          if (f.GetImage(sz, 0x1 | 0x4, out hbm) != 0 || hbm == IntPtr.Zero) return "";   // BIGGERSIZEOK | ICONONLY
          try {
            using (var tmp = System.Drawing.Image.FromHbitmap(hbm)) {
              var r = new System.Drawing.Rectangle(0, 0, tmp.Width, tmp.Height);
              var bd = tmp.LockBits(r, System.Drawing.Imaging.ImageLockMode.ReadOnly, tmp.PixelFormat);
              try {
                using (var argb = new System.Drawing.Bitmap(bd.Width, bd.Height, bd.Stride, System.Drawing.Imaging.PixelFormat.Format32bppPArgb, bd.Scan0))
                using (var ms = new System.IO.MemoryStream()) { argb.Save(ms, System.Drawing.Imaging.ImageFormat.Png); return Convert.ToBase64String(ms.ToArray()); }
              } finally { tmp.UnlockBits(bd); }
            }
          } finally { DeleteObject(hbm); }
        } finally { Marshal.ReleaseComObject(f); }
      } catch { return ""; }
    }
  }
}
'@

$src = $src.Replace('__EVDLL__', $(if ($dllName) { $dllName } else { 'Everything64.dll' }))
Add-Type -TypeDefinition $src -ReferencedAssemblies System.Data, System.Drawing
$evOk = $false
if ($dllPath -and (Test-Path $dllPath)) { try { $evOk = [NotchSearch.Ev]::Load($dllPath) } catch { $evOk = $false } }
if (-not ($evOk -and [NotchSearch.Ev]::Running())) { [NotchSearch.Walk]::Start() }

function Out-Line([string]$s) { [Console]::Out.WriteLine($s); [Console]::Out.Flush() }
function Reply([string]$id, [string]$json) { Out-Line ('{"id":' + [NotchSearch.J]::S($id) + ',"data":' + $json + '}') }

function Get-Apps {
  $list = $null
  try { $list = @(Get-StartApps | ForEach-Object { @{ n = [string]$_.Name; id = [string]$_.AppID } }) } catch { $list = $null }
  if (-not $list -or $list.Count -eq 0) {
    # no Get-StartApps on this edition: the same list straight from the shell's Applications folder
    $sh = New-Object -ComObject Shell.Application
    $list = @($sh.NameSpace('shell:::{4234d49b-0245-4df3-b780-3893943456e1}').Items() | ForEach-Object { @{ n = [string]$_.Name; id = [string]$_.Path } })
  }
  $list = @($list | Where-Object { $_.n -and $_.id })
  if ($list.Count -eq 0) { return '[]' }
  $json = ConvertTo-Json -InputObject $list -Compress -Depth 3
  if (-not $json.StartsWith('[')) { $json = "[$json]" }
  return $json
}

Out-Line ('{"id":"ready","data":{"everything":' + $(if ($evOk) { 'true' } else { 'false' }) + '}}')

$stdin = New-Object System.IO.StreamReader ([Console]::OpenStandardInput()), ([System.Text.Encoding]::UTF8)
while ($null -ne ($line = $stdin.ReadLine())) {
  $p = $line.Split("`t", 3)
  if ($p.Count -lt 2) { continue }
  $id = $p[0]; $cmd = $p[1]; $arg = if ($p.Count -gt 2) { $p[2] } else { '' }
  try {
    switch ($cmd) {
      'status' { Reply $id ([NotchSearch.Ev]::Status()) }
      'files' {
        $r = $null
        if ($evOk) { $r = [NotchSearch.Ev]::Files($arg) }
        if (-not $r) { try { $r = [NotchSearch.Ws]::Files($arg, 40) } catch { $r = '{"engine":"none","items":[]}' } }
        Reply $id $r
      }
      'apps' { Reply $id (Get-Apps) }
      'appicon' { Reply $id ([NotchSearch.J]::S([NotchSearch.Icons]::App($arg, 48))) }
      default { Out-Line ('{"id":' + [NotchSearch.J]::S($id) + ',"error":"unknown command"}') }
    }
  } catch {
    Out-Line ('{"id":' + [NotchSearch.J]::S($id) + ',"error":' + [NotchSearch.J]::S("$_") + '}')
  }
}
