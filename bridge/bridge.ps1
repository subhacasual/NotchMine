# NotchMine native bridge
# Talks to Electron over stdin/stdout using one JSON object per line.
#   OUT: {"type":"media",...} {"type":"volume",...} {"type":"brightness",...} {"type":"log",...}
#   IN : "media toggle|play|pause|next|prev", "media seek <seconds>",
#        "vol set <0..1>", "vol mute", "bright set <0..100>", "bright get"

$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
[Console]::InputEncoding  = [System.Text.Encoding]::UTF8

function Send($obj) {
  $json = $obj | ConvertTo-Json -Compress -Depth 4
  [Console]::Out.WriteLine($json)
  [Console]::Out.Flush()
}
function Log($msg) { Send @{ type = 'log'; message = "$msg" } }

# ---------------------------------------------------------------- Core Audio (volume)
$audioSrc = @'
using System;
using System.Runtime.InteropServices;

namespace NotchMine {
  [ComImport, Guid("5CDF2C82-841E-4546-9722-0CF74078229A"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  interface IAudioEndpointVolume {
    [PreserveSig] int RegisterControlChangeNotify(IntPtr p);
    [PreserveSig] int UnregisterControlChangeNotify(IntPtr p);
    [PreserveSig] int GetChannelCount(out uint c);
    [PreserveSig] int SetMasterVolumeLevel(float level, ref Guid ctx);
    [PreserveSig] int SetMasterVolumeLevelScalar(float level, ref Guid ctx);
    [PreserveSig] int GetMasterVolumeLevel(out float level);
    [PreserveSig] int GetMasterVolumeLevelScalar(out float level);
    [PreserveSig] int SetChannelVolumeLevel(uint ch, float level, ref Guid ctx);
    [PreserveSig] int SetChannelVolumeLevelScalar(uint ch, float level, ref Guid ctx);
    [PreserveSig] int GetChannelVolumeLevel(uint ch, out float level);
    [PreserveSig] int GetChannelVolumeLevelScalar(uint ch, out float level);
    [PreserveSig] int SetMute([MarshalAs(UnmanagedType.Bool)] bool mute, ref Guid ctx);
    [PreserveSig] int GetMute([MarshalAs(UnmanagedType.Bool)] out bool mute);
  }

  [ComImport, Guid("D666063F-1587-4E43-81F1-B948E807363F"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  interface IMMDevice {
    [PreserveSig] int Activate(ref Guid iid, int clsCtx, IntPtr activationParams, [MarshalAs(UnmanagedType.IUnknown)] out object iface);
    [PreserveSig] int OpenPropertyStore(int access, out IPropertyStore store);
    [PreserveSig] int GetId([MarshalAs(UnmanagedType.LPWStr)] out string id);
    [PreserveSig] int GetState(out int state);
  }

  [StructLayout(LayoutKind.Sequential)] struct PROPERTYKEY { public Guid fmtid; public int pid; }
  [StructLayout(LayoutKind.Explicit, Size = 24)] struct PROPVARIANT { [FieldOffset(0)] public ushort vt; [FieldOffset(8)] public IntPtr p; }

  [ComImport, Guid("886d8eeb-8cf2-4446-8d02-cdba1dbdcf99"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  interface IPropertyStore {
    [PreserveSig] int GetCount(out int c);
    [PreserveSig] int GetAt(int i, out PROPERTYKEY k);
    [PreserveSig] int GetValue(ref PROPERTYKEY k, out PROPVARIANT v);
    [PreserveSig] int SetValue(ref PROPERTYKEY k, ref PROPVARIANT v);
    [PreserveSig] int Commit();
  }

  [ComImport, Guid("77AA99A0-1BD6-484F-8BC7-2C654C9A9B6F"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  interface IAudioSessionManager2 {
    [PreserveSig] int GetAudioSessionControl(IntPtr guid, int flags, out IntPtr ctl);
    [PreserveSig] int GetSimpleAudioVolume(IntPtr guid, int flags, out IntPtr vol);
    [PreserveSig] int GetSessionEnumerator(out IAudioSessionEnumerator e);
  }

  [ComImport, Guid("E2F5BB11-0570-40CA-ACDD-3AA01277DEE8"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  interface IAudioSessionEnumerator {
    [PreserveSig] int GetCount(out int c);
    [PreserveSig] int GetSession(int i, out IAudioSessionControl2 s);
  }

  [ComImport, Guid("bfb7ff88-7239-4fc9-8fa2-07c950be9c6d"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  interface IAudioSessionControl2 {
    [PreserveSig] int GetState(out int state);
    [PreserveSig] int GetDisplayName([MarshalAs(UnmanagedType.LPWStr)] out string name);
    [PreserveSig] int SetDisplayName([MarshalAs(UnmanagedType.LPWStr)] string v, ref Guid ctx);
    [PreserveSig] int GetIconPath([MarshalAs(UnmanagedType.LPWStr)] out string p);
    [PreserveSig] int SetIconPath([MarshalAs(UnmanagedType.LPWStr)] string v, ref Guid ctx);
    [PreserveSig] int GetGroupingParam(out Guid g);
    [PreserveSig] int SetGroupingParam(ref Guid g, ref Guid ctx);
    [PreserveSig] int RegisterAudioSessionNotification(IntPtr n);
    [PreserveSig] int UnregisterAudioSessionNotification(IntPtr n);
    [PreserveSig] int GetSessionIdentifier([MarshalAs(UnmanagedType.LPWStr)] out string s);
    [PreserveSig] int GetSessionInstanceIdentifier([MarshalAs(UnmanagedType.LPWStr)] out string s);
    [PreserveSig] int GetProcessId(out uint pid);
    [PreserveSig] int IsSystemSoundsSession();
    [PreserveSig] int SetDuckingPreference([MarshalAs(UnmanagedType.Bool)] bool optOut);
  }

  [ComImport, Guid("87CE5498-68D6-44E5-9215-6DA47EF883D8"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  interface ISimpleAudioVolume {
    [PreserveSig] int SetMasterVolume(float level, ref Guid ctx);
    [PreserveSig] int GetMasterVolume(out float level);
    [PreserveSig] int SetMute([MarshalAs(UnmanagedType.Bool)] bool mute, ref Guid ctx);
    [PreserveSig] int GetMute([MarshalAs(UnmanagedType.Bool)] out bool mute);
  }

  [ComImport, Guid("A95664D2-9614-4F35-A746-DE8DB63617E6"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  interface IMMDeviceEnumerator {
    [PreserveSig] int EnumAudioEndpoints(int dataFlow, int mask, out IntPtr devices);
    [PreserveSig] int GetDefaultAudioEndpoint(int dataFlow, int role, out IMMDevice device);
  }

  [ComImport, Guid("BCDE0395-E52F-467C-8E3D-C4579291692E")]
  class MMDeviceEnumerator { }

  public static class Win {
    [StructLayout(LayoutKind.Sequential)] struct RECT { public int L, T, R, B; }
    [StructLayout(LayoutKind.Sequential)] struct MONITORINFO { public int cbSize; public RECT rcMonitor; public RECT rcWork; public uint dwFlags; }
    [DllImport("user32.dll")] static extern IntPtr GetForegroundWindow();
    [DllImport("user32.dll")] static extern bool GetWindowRect(IntPtr h, out RECT r);
    [DllImport("user32.dll")] static extern IntPtr MonitorFromWindow(IntPtr h, uint flags);
    [DllImport("user32.dll")] static extern bool GetMonitorInfo(IntPtr m, ref MONITORINFO mi);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern int GetClassName(IntPtr h, System.Text.StringBuilder s, int n);
    [DllImport("user32.dll")] static extern bool SetProcessDPIAware();
    [DllImport("user32.dll")] public static extern uint GetClipboardSequenceNumber();
    [DllImport("user32.dll")] static extern short GetKeyState(int vk);
    public static bool KeyToggled(int vk) { return (GetKeyState(vk) & 1) == 1; }
    [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
    [DllImport("kernel32.dll")] static extern IntPtr OpenProcess(uint access, bool inherit, int pid);
    [DllImport("kernel32.dll")] static extern bool CloseHandle(IntPtr h);
    [DllImport("kernel32.dll", CharSet = CharSet.Unicode)] static extern bool QueryFullProcessImageName(IntPtr h, int flags, System.Text.StringBuilder s, ref int n);
    // full exe path with the least access rights, so it also works for games protected by anti-cheat
    public static string ProcPath(int pid) {
      IntPtr h = OpenProcess(0x1000, false, pid);              // PROCESS_QUERY_LIMITED_INFORMATION
      if (h == IntPtr.Zero) return "";
      try { var sb = new System.Text.StringBuilder(1024); int n = sb.Capacity; return QueryFullProcessImageName(h, 0, sb, ref n) ? sb.ToString() : ""; }
      finally { CloseHandle(h); }
    }
    [DllImport("user32.dll")] static extern bool IsZoomed(IntPtr h);
    [DllImport("user32.dll")] static extern bool IsIconic(IntPtr h);
    [DllImport("user32.dll")] static extern bool IsWindow(IntPtr h);
    [DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr h);
    // a window counts as "maximized" when Windows says so, or when it fills its monitor (e.g. F11)
    static bool Big(IntPtr h) {
      if (IsZoomed(h)) return true;
      RECT r; if (!GetWindowRect(h, out r)) return false;
      var mi = new MONITORINFO(); mi.cbSize = Marshal.SizeOf(typeof(MONITORINFO));
      if (!GetMonitorInfo(MonitorFromWindow(h, 2), ref mi)) return false;
      return r.L <= mi.rcWork.L + 2 && r.T <= mi.rcWork.T + 2 && r.R >= mi.rcWork.R - 2 && r.B >= mi.rcWork.B - 2;
    }
    // "hwnd|pid|class|left,top,right,bottom|maximized" of the active window (physical pixels)
    public static string ForegroundInfo() {
      if (!dpi) { SetProcessDPIAware(); dpi = true; }
      IntPtr h = GetForegroundWindow();
      if (h == IntPtr.Zero) return "";
      uint pid; GetWindowThreadProcessId(h, out pid);
      var sb = new System.Text.StringBuilder(256); GetClassName(h, sb, 256);
      RECT r; GetWindowRect(h, out r);
      return h.ToInt64() + "|" + pid + "|" + sb.ToString() + "|" + r.L + "," + r.T + "," + r.R + "," + r.B + "|" + (Big(h) && !IsIconic(h) ? 1 : 0);
    }
    // the window side mode is following: 0 gone/hidden, 1 minimized, 2 normal size, 3 maximized
    public static int WindowState(long hwnd) {
      IntPtr h = new IntPtr(hwnd);
      if (!IsWindow(h) || !IsWindowVisible(h)) return 0;
      if (IsIconic(h)) return 1;
      return Big(h) ? 3 : 2;
    }
    static bool dpi;
    // "" when the foreground window isn't full-screen, else the rect of the monitor it fills ("L,T,R,B", physical px)
    public static string ForegroundFullscreenMonitor() {
      if (!dpi) { SetProcessDPIAware(); dpi = true; }
      IntPtr h = GetForegroundWindow();
      if (h == IntPtr.Zero) return "";
      var sb = new System.Text.StringBuilder(256);
      GetClassName(h, sb, 256);
      string c = sb.ToString();
      if (c == "Progman" || c == "WorkerW" || c == "Shell_TrayWnd" || c == "Shell_SecondaryTrayWnd") return "";
      RECT r;
      if (!GetWindowRect(h, out r)) return "";
      var mi = new MONITORINFO(); mi.cbSize = Marshal.SizeOf(typeof(MONITORINFO));
      if (!GetMonitorInfo(MonitorFromWindow(h, 2), ref mi)) return "";
      var m = mi.rcMonitor;
      if (!(r.L <= m.L && r.T <= m.T && r.R >= m.R && r.B >= m.B)) return "";
      return m.L + "," + m.T + "," + m.R + "," + m.B;
    }
  }

  public static class Audio {
    static IAudioEndpointVolume Endpoint() {
      var en = (IMMDeviceEnumerator)(new MMDeviceEnumerator());
      IMMDevice dev;
      Marshal.ThrowExceptionForHR(en.GetDefaultAudioEndpoint(0, 1, out dev));
      Guid iid = typeof(IAudioEndpointVolume).GUID;
      object o;
      Marshal.ThrowExceptionForHR(dev.Activate(ref iid, 23, IntPtr.Zero, out o));
      return (IAudioEndpointVolume)o;
    }
    public static float GetVolume() { float v; Marshal.ThrowExceptionForHR(Endpoint().GetMasterVolumeLevelScalar(out v)); return v; }
    public static void SetVolume(float v) { Guid g = Guid.Empty; Marshal.ThrowExceptionForHR(Endpoint().SetMasterVolumeLevelScalar(Math.Max(0f, Math.Min(1f, v)), ref g)); }
    public static bool GetMute() { bool m; Marshal.ThrowExceptionForHR(Endpoint().GetMute(out m)); return m; }
    public static void SetMute(bool m) { Guid g = Guid.Empty; Marshal.ThrowExceptionForHR(Endpoint().SetMute(m, ref g)); }

    [DllImport("ole32.dll")] static extern int PropVariantClear(ref PROPVARIANT pv);

    static IMMDevice Device(int flow, int role) {
      var en = (IMMDeviceEnumerator)(new MMDeviceEnumerator());
      IMMDevice dev;
      return en.GetDefaultAudioEndpoint(flow, role, out dev) == 0 ? dev : null;
    }
    static IAudioEndpointVolume VolumeOf(IMMDevice dev) {
      Guid iid = typeof(IAudioEndpointVolume).GUID; object o;
      Marshal.ThrowExceptionForHR(dev.Activate(ref iid, 23, IntPtr.Zero, out o));
      return (IAudioEndpointVolume)o;
    }

    // "id|friendly name" of the default playback device
    public static string OutputInfo() {
      var dev = Device(0, 1);
      if (dev == null) return "";
      string id; dev.GetId(out id);
      string name = "";
      IPropertyStore ps;
      if (dev.OpenPropertyStore(0, out ps) == 0) {
        var key = new PROPERTYKEY { fmtid = new Guid("a45c254e-df1c-4efd-8020-67d146a850e0"), pid = 14 };
        PROPVARIANT v;
        if (ps.GetValue(ref key, out v) == 0) { if (v.vt == 31) name = Marshal.PtrToStringUni(v.p); PropVariantClear(ref v); }
      }
      return id + "|" + name;
    }

    // microphone (capture) mute: -1 = no mic
    public static int MicMuted() {
      var d = Device(1, 2) ?? Device(1, 0);
      if (d == null) return -1;
      bool m; VolumeOf(d).GetMute(out m);
      return m ? 1 : 0;
    }
    public static void SetMicMute(bool m) {
      foreach (int role in new[] { 0, 2 }) {
        var d = Device(1, role);
        if (d != null) { Guid g = Guid.Empty; VolumeOf(d).SetMute(m, ref g); }
      }
    }

    static IAudioSessionEnumerator SessionEnum() {
      var dev = Device(0, 1);
      if (dev == null) return null;
      Guid iid = new Guid("77AA99A0-1BD6-484F-8BC7-2C654C9A9B6F"); object o;
      if (dev.Activate(ref iid, 23, IntPtr.Zero, out o) != 0) return null;
      IAudioSessionEnumerator en;
      return ((IAudioSessionManager2)o).GetSessionEnumerator(out en) == 0 ? en : null;
    }

    // one line per session: pid \t isSystem \t volume \t muted \t state
    public static string Sessions() {
      var en = SessionEnum();
      if (en == null) return "";
      int n; en.GetCount(out n);
      var sb = new System.Text.StringBuilder();
      for (int i = 0; i < n; i++) {
        IAudioSessionControl2 s;
        if (en.GetSession(i, out s) != 0 || s == null) continue;
        int state; s.GetState(out state);
        if (state == 2) continue;
        uint pid; s.GetProcessId(out pid);
        bool sys = s.IsSystemSoundsSession() == 0;
        var vol = (ISimpleAudioVolume)s;
        float lv; vol.GetMasterVolume(out lv);
        bool mu; vol.GetMute(out mu);
        sb.Append(pid).Append('\t').Append(sys ? 1 : 0).Append('\t')
          .Append(lv.ToString("0.00", System.Globalization.CultureInfo.InvariantCulture)).Append('\t')
          .Append(mu ? 1 : 0).Append('\t').Append(state).Append('\n');
      }
      return sb.ToString();
    }

    // level < 0 leaves volume alone; mute: -1 leave, 0/1 set, 2 toggle
    public static void SetSession(uint pid, float level, int mute) {
      var en = SessionEnum();
      if (en == null) return;
      int n; en.GetCount(out n);
      for (int i = 0; i < n; i++) {
        IAudioSessionControl2 s;
        if (en.GetSession(i, out s) != 0 || s == null) continue;
        uint p; s.GetProcessId(out p);
        bool sys = s.IsSystemSoundsSession() == 0;
        if (!(p == pid && (pid != 0 || sys))) continue;
        var vol = (ISimpleAudioVolume)s;
        Guid g = Guid.Empty;
        if (level >= 0) vol.SetMasterVolume(Math.Max(0f, Math.Min(1f, level)), ref g);
        if (mute == 2) { bool m; vol.GetMute(out m); vol.SetMute(!m, ref g); }
        else if (mute >= 0) vol.SetMute(mute == 1, ref g);
      }
    }
  }
}
'@
$audioOk = $true
try { Add-Type -TypeDefinition $audioSrc -Language CSharp } catch { $audioOk = $false; Log "audio init failed: $_" }

# ---------------------------------------------------------------- GPU load (performance counters)
$gpuSrc = @'
using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;

namespace NotchMine {
  // GPU load the way Task Manager shows it: per engine (3D, copy, video…) the sum over all
  // processes, then the busiest engine. Read from Windows' own "GPU Engine" performance counters.
  public static class Gpu {
    [DllImport("pdh.dll", CharSet = CharSet.Unicode)] static extern uint PdhOpenQuery(string src, IntPtr user, out IntPtr q);
    [DllImport("pdh.dll", CharSet = CharSet.Unicode)] static extern uint PdhAddEnglishCounter(IntPtr q, string path, IntPtr user, out IntPtr c);
    [DllImport("pdh.dll")] static extern uint PdhCollectQueryData(IntPtr q);
    [DllImport("pdh.dll", CharSet = CharSet.Unicode)] static extern uint PdhGetFormattedCounterArray(IntPtr c, uint fmt, ref uint size, out uint count, IntPtr buf);
    [StructLayout(LayoutKind.Sequential)] struct Item { public IntPtr name; public uint status; public double value; }
    const uint PDH_FMT_DOUBLE = 0x200, PDH_FMT_NOCAP100 = 0x8000, PDH_MORE_DATA = 0x800007D2;
    static IntPtr q, cUtil, cMem;
    static bool ok;
    public static bool Init() {
      if (ok) return true;
      if (PdhOpenQuery(null, IntPtr.Zero, out q) != 0) return false;
      if (PdhAddEnglishCounter(q, @"\GPU Engine(*)\Utilization Percentage", IntPtr.Zero, out cUtil) != 0) return false;
      PdhAddEnglishCounter(q, @"\GPU Adapter Memory(*)\Dedicated Usage", IntPtr.Zero, out cMem);   // optional
      PdhCollectQueryData(q);                                 // utilization is a rate: needs a first sample
      ok = true;
      return true;
    }
    static Dictionary<string, double> Read(IntPtr c) {
      var res = new Dictionary<string, double>();
      if (c == IntPtr.Zero) return res;
      uint size = 0, count;
      uint r = PdhGetFormattedCounterArray(c, PDH_FMT_DOUBLE | PDH_FMT_NOCAP100, ref size, out count, IntPtr.Zero);
      if (r != PDH_MORE_DATA || size == 0) return res;
      IntPtr buf = Marshal.AllocHGlobal((int)size);
      try {
        if (PdhGetFormattedCounterArray(c, PDH_FMT_DOUBLE | PDH_FMT_NOCAP100, ref size, out count, buf) != 0) return res;
        int step = Marshal.SizeOf(typeof(Item));
        for (int i = 0; i < count; i++) {
          var it = (Item)Marshal.PtrToStructure(new IntPtr(buf.ToInt64() + i * step), typeof(Item));
          if (it.status != 0 && it.status != 1) continue;            // PDH_CSTATUS_VALID_DATA / NEW_DATA
          res[Marshal.PtrToStringUni(it.name)] = it.value;
        }
      } finally { Marshal.FreeHGlobal(buf); }
      return res;
    }
    // "util,dedicatedBytes" or "" when the counters aren't available
    static Dictionary<int, double> pidUtil = new Dictionary<int, double>();
    public static int PidUtil(int pid) { double v; return pidUtil.TryGetValue(pid, out v) ? (int)Math.Round(Math.Min(100, v)) : 0; }
    public static string Sample() {
      if (!Init() || PdhCollectQueryData(q) != 0) return "";
      var engines = new Dictionary<string, double>();
      var perPid = new Dictionary<int, double>();
      foreach (var kv in Read(cUtil)) {
        // pid_1234_luid_0x00000000_0x0000D1B2_phys_0_eng_0_engtype_3D → one engine of one adapter
        int at = kv.Key.IndexOf("luid_", StringComparison.Ordinal);
        string key = at >= 0 ? kv.Key.Substring(at) : kv.Key;
        double v; engines.TryGetValue(key, out v);
        engines[key] = v + kv.Value;
        // per process: its busiest engine (used to spot a game nobody has listed yet)
        int pid;
        if (kv.Key.StartsWith("pid_", StringComparison.Ordinal) && int.TryParse(kv.Key.Substring(4, Math.Max(0, kv.Key.IndexOf('_', 4) - 4)), out pid)) {
          double p; perPid.TryGetValue(pid, out p);
          if (kv.Value > p) perPid[pid] = kv.Value;
        }
      }
      pidUtil = perPid;
      double max = 0;
      foreach (var v in engines.Values) if (v > max) max = v;
      double mem = 0;                                          // the adapter using the most (the graphics card)
      foreach (var v in Read(cMem).Values) if (v > mem) mem = v;
      return Math.Round(Math.Min(100, max)) + "," + (long)mem;
    }
  }
}
'@
$gpuOk = $true
try { Add-Type -TypeDefinition $gpuSrc -Language CSharp } catch { $gpuOk = $false; Log "gpu init failed: $_" }
$script:gpuInfo = $null
# Windows' own list of games it has seen (Game Bar / Game Mode remember these): full exe paths
function Send-Games {
  try {
    $paths = @()
    foreach ($k in Get-ChildItem 'HKCU:\System\GameConfigStore\Children' -ErrorAction SilentlyContinue) {
      try { $v = (Get-ItemProperty $k.PSPath -ErrorAction Stop).MatchedExeFullPath; if ($v) { $paths += "$v" } } catch {}
    }
    Send @{ type = 'games'; paths = $paths }
  } catch {}
}
function Poll-Gpu {
  if (-not $gpuOk) { return }
  try {
    if ($null -eq $script:gpuInfo) {
      # name + memory size of the graphics card (the adapter with the most memory, i.e. the discrete one)
      $best = $null
      foreach ($k in Get-ChildItem 'HKLM:\SYSTEM\CurrentControlSet\Control\Class\{4d36e968-e325-11ce-bfc1-08002be10318}' -ErrorAction SilentlyContinue) {
        try {
          $p = Get-ItemProperty $k.PSPath -ErrorAction Stop
          $mem = [int64]0; try { $mem = [int64]$p.'HardwareInformation.qwMemorySize' } catch {}
          if ($p.DriverDesc -and ($null -eq $best -or $mem -gt $best.mem)) { $best = @{ name = "$($p.DriverDesc)"; mem = $mem } }
        } catch {}
      }
      $script:gpuInfo = if ($best) { $best } else { @{ name = ''; mem = [int64]0 } }
    }
    $s = [NotchMine.Gpu]::Sample()
    if (-not $s) { return }
    $u, $m = $s.Split(',')
    $fg = if ($script:fgPid) { [NotchMine.Gpu]::PidUtil($script:fgPid) } else { 0 }
    Send @{ type = 'gpu'; util = [int]$u; vram = [int64]$m; vramTotal = $script:gpuInfo.mem; name = $script:gpuInfo.name; fgUtil = $fg }
  } catch {}
}

# ---------------------------------------------------------------- WinRT (media sessions)
Add-Type -AssemblyName System.Runtime.WindowsRuntime
$asTaskGeneric = ([System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object {
    $_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and
    $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation`1' })[0]

function Await($op, [Type]$resultType) {
  $task = $asTaskGeneric.MakeGenericMethod($resultType).Invoke($null, @($op))
  if (-not $task.Wait(3000)) { throw 'WinRT call timed out' }
  $task.Result
}

$mediaOk = $true
try {
  [void][Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager, Windows.Media.Control, ContentType = WindowsRuntime]
  [void][Windows.Media.Control.GlobalSystemMediaTransportControlsSessionMediaProperties, Windows.Media.Control, ContentType = WindowsRuntime]
  [void][Windows.Storage.Streams.IRandomAccessStreamWithContentType, Windows.Storage.Streams, ContentType = WindowsRuntime]
  $mgr = Await ([Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager]::RequestAsync()) `
               ([Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager])
} catch { $mediaOk = $false; Log "media init failed: $_" }

function Get-Session {
  if (-not $mediaOk) { return $null }
  $cur = $mgr.GetCurrentSession()
  # Prefer whichever session is actually playing
  foreach ($s in $mgr.GetSessions()) {
    try { if ($s.GetPlaybackInfo().PlaybackStatus -eq 'Playing') { return $s } } catch {}
  }
  return $cur
}

$asStreamForRead = $null; $contentTypeProp = $null
try {
  $asStreamForRead = [System.IO.WindowsRuntimeStreamExtensions].GetMethod('AsStreamForRead', [Type[]]@([Windows.Storage.Streams.IInputStream]))
  $contentTypeProp = [Windows.Storage.Streams.IContentTypeProvider].GetProperty('ContentType')
} catch { Log "artwork reader init failed: $_" }

function Read-Thumbnail($props) {
  try {
    if ($null -eq $props.Thumbnail) { return $null }
    $stream = Await ($props.Thumbnail.OpenReadAsync()) ([Windows.Storage.Streams.IRandomAccessStreamWithContentType])
    # Chromium (Chrome / Edge / YouTube Music app) hands back a bare COM object that PowerShell can't
    # convert to a stream, so call through the interfaces with reflection (works for every player)
    $net = $script:asStreamForRead.Invoke($null, @($stream))
    $ms = New-Object System.IO.MemoryStream
    $net.CopyTo($ms)
    $net.Dispose()
    # browsers can hand out an empty stream while the artwork is still downloading: that's "no art yet"
    if ($ms.Length -lt 64) { return $null }
    $type = $null
    try { $type = $script:contentTypeProp.GetValue($stream) } catch {}
    if ([string]::IsNullOrEmpty($type)) { $type = 'image/png' }
    return "data:$type;base64," + [Convert]::ToBase64String($ms.ToArray())
  } catch { return $null }
}

$lastKey = ''
$lastThumb = $null
$thumbSeq = 0
$thumbSentSeq = -1
$thumbRetries = 0
$thumbRecheck = 0
$lastMediaJson = ''

function Poll-Media([bool]$force) {
  $s = $null
  try { $s = Get-Session } catch {}
  if ($null -eq $s) {
    $out = @{ type = 'media'; active = $false }
  } else {
    try {
      $props = Await ($s.TryGetMediaPropertiesAsync()) ([Windows.Media.Control.GlobalSystemMediaTransportControlsSessionMediaProperties])
      $pb = $s.GetPlaybackInfo()
      $tl = $s.GetTimelineProperties()
      $key = "$($s.SourceAppUserModelId)|$($props.Title)|$($props.Artist)"
      if ($key -ne $script:lastKey -and "$key|nothumb" -ne $script:lastKey) {
        $script:lastKey = $key
        $script:lastThumb = Read-Thumbnail $props
        $script:thumbSeq++
        $script:thumbRetries = 0
        $script:thumbRecheck = 6
        # Some players (browsers / YouTube especially) publish artwork well after the title; keep retrying (~15 s)
        if ($null -eq $script:lastThumb) { $script:lastKey = "$key|nothumb" }
      } elseif ($script:lastKey.EndsWith('|nothumb') -and $script:thumbRetries -lt 25) {
        $script:thumbRetries++
        $t = Read-Thumbnail $props
        if ($t) { $script:lastThumb = $t; $script:lastKey = $key; $script:thumbSeq++ }
      } elseif ($script:thumbRecheck -gt 0) {
        # right after a track change some players still hand out the previous song's art for a moment
        $script:thumbRecheck--
        $t = Read-Thumbnail $props
        if ($t -and $t -ne $script:lastThumb) { $script:lastThumb = $t; $script:thumbSeq++ }
      }
      $c = $pb.Controls
      $out = @{
        type      = 'media'
        active    = $true
        app       = "$($s.SourceAppUserModelId)"
        title     = "$($props.Title)"
        artist    = "$($props.Artist)"
        album     = "$($props.AlbumTitle)"
        status    = "$($pb.PlaybackStatus)"
        position  = [math]::Round($tl.Position.TotalSeconds, 2)
        duration  = [math]::Round(($tl.EndTime - $tl.StartTime).TotalSeconds, 2)
        updatedAt = [int64]($tl.LastUpdatedTime.ToUnixTimeMilliseconds())
        canPrev   = [bool]$c.IsPreviousEnabled
        canNext   = [bool]$c.IsNextEnabled
        canSeek   = [bool]$c.IsPlaybackPositionEnabled
        thumbId   = $script:thumbSeq
      }
    } catch {
      $out = @{ type = 'media'; active = $false }
    }
  }
  $json = $out | ConvertTo-Json -Compress -Depth 4
  if ($force -or $json -ne $script:lastMediaJson) {
    $script:lastMediaJson = $json
    # Artwork is large, so only ship it when it changed (or on a forced refresh)
    if ($out.active -and ($force -or $script:thumbSentSeq -ne $script:thumbSeq)) {
      $script:thumbSentSeq = $script:thumbSeq
      $out.thumb = $script:lastThumb
      $json = $out | ConvertTo-Json -Compress -Depth 4
    }
    [Console]::Out.WriteLine($json)
    [Console]::Out.Flush()
  }
}

$lastVol = ''
function Poll-Volume([bool]$force) {
  if (-not $audioOk) { return }
  try {
    $v = [math]::Round([NotchMine.Audio]::GetVolume(), 2)
    $m = [NotchMine.Audio]::GetMute()
    $k = "$v|$m"
    if ($force -or $k -ne $script:lastVol) {
      $script:lastVol = $k
      Send @{ type = 'volume'; level = $v; muted = $m }
    }
  } catch {}
}

function Get-Brightness {
  try {
    $b = Get-CimInstance -Namespace root/WMI -ClassName WmiMonitorBrightness -ErrorAction Stop | Select-Object -First 1
    Send @{ type = 'brightness'; supported = $true; level = [int]$b.CurrentBrightness }
  } catch { Send @{ type = 'brightness'; supported = $false; level = 0 } }
}

function Set-Brightness([int]$level) {
  try {
    $m = Get-CimInstance -Namespace root/WMI -ClassName WmiMonitorBrightnessMethods -ErrorAction Stop | Select-Object -First 1
    Invoke-CimMethod -InputObject $m -MethodName WmiSetBrightness -Arguments @{ Timeout = 1; Brightness = [byte]$level } | Out-Null
  } catch {}
}

# ---------------------------------------------------------------- network throughput
$netPrev = $null
function Poll-Network {
  try {
    $rx = [int64]0; $tx = [int64]0; $names = @()
    foreach ($n in [System.Net.NetworkInformation.NetworkInterface]::GetAllNetworkInterfaces()) {
      if ($n.OperationalStatus -ne 'Up') { continue }
      if ($n.NetworkInterfaceType -eq 'Loopback' -or $n.NetworkInterfaceType -eq 'Tunnel') { continue }
      if ($n.Description -match 'Hyper-V|VirtualBox|VMware|WSL|Loopback|Bluetooth|TAP-|Npcap') { continue }
      $st = $n.GetIPStatistics()
      $rx += $st.BytesReceived; $tx += $st.BytesSent
      if ($st.BytesReceived -gt 0) { $names += $n.Name }
    }
    $now = [DateTime]::UtcNow
    if ($null -ne $script:netPrev) {
      $dt = ($now - $script:netPrev.t).TotalSeconds
      if ($dt -gt 0.2) {
        Send @{
          type = 'net'
          rx = [int64][math]::Max(0, ($rx - $script:netPrev.rx) / $dt)
          tx = [int64][math]::Max(0, ($tx - $script:netPrev.tx) / $dt)
          name = ($names | Select-Object -First 1)
        }
      }
    }
    $script:netPrev = @{ rx = $rx; tx = $tx; t = $now }
  } catch {}
}

# ---------------------------------------------------------------- connection type + signal bars (no network name, no location needed)
$netKindLast = ''
$netInfoOk = $true
try { [void][Windows.Networking.Connectivity.NetworkInformation, Windows.Networking.Connectivity, ContentType = WindowsRuntime] } catch { $netInfoOk = $false }
function Poll-Connection {
  if (-not $netInfoOk) { return }
  try {
    $p = [Windows.Networking.Connectivity.NetworkInformation]::GetInternetConnectionProfile()
    $kind = 'none'; $bars = 0; $online = $false
    if ($p) {
      $online = "$($p.GetNetworkConnectivityLevel())" -eq 'InternetAccess'
      if ($p.IsWlanConnectionProfile) { $kind = 'wifi' } elseif ($p.IsWwanConnectionProfile) { $kind = 'cell' } else { $kind = 'ethernet' }
      $b = $p.GetSignalBars(); if ($null -ne $b) { $bars = [int]$b }
    }
    $k = "$kind|$bars|$online"
    if ($k -ne $script:netKindLast) { $script:netKindLast = $k; Send @{ type = 'conn'; kind = $kind; bars = $bars; online = $online } }
  } catch {}
}

# ---------------------------------------------------------------- notifications (Action Center)
$notifEnabled = $false
$notifOk = $false
$notifSeen = @{}
$notifIcons = @{}
$notifPrimed = $false
try {
  [void][Windows.UI.Notifications.Management.UserNotificationListener, Windows.UI.Notifications, ContentType = WindowsRuntime]
  [void][Windows.UI.Notifications.UserNotification, Windows.UI.Notifications, ContentType = WindowsRuntime]
  $listener = [Windows.UI.Notifications.Management.UserNotificationListener]::Current
  $notifOk = $true
} catch { Log "notification listener unavailable: $_" }

function Read-StreamRef($ref) {
  try {
    $stream = Await ($ref.OpenReadAsync()) ([Windows.Storage.Streams.IRandomAccessStreamWithContentType])
    $net = [System.IO.WindowsRuntimeStreamExtensions]::AsStreamForRead($stream)
    $ms = New-Object System.IO.MemoryStream
    $net.CopyTo($ms); $net.Dispose()
    $type = $stream.ContentType; if ([string]::IsNullOrEmpty($type)) { $type = 'image/png' }
    return "data:$type;base64," + [Convert]::ToBase64String($ms.ToArray())
  } catch { return $null }
}

function Poll-Notifications {
  if (-not ($notifOk -and $notifEnabled)) { return }
  try {
    $status = "$($listener.GetAccessStatus())"
    if ($status -ne 'Allowed') {
      try { $status = "$(Await ($listener.RequestAccessAsync()) ([Windows.UI.Notifications.Management.UserNotificationListenerAccessStatus]))" } catch {}
    }
    if ($status -ne $script:notifStatus) { $script:notifStatus = $status; Send @{ type = 'notif-status'; status = $status } }
    if ($status -ne 'Allowed') { return }
    $list = Await ($listener.GetNotificationsAsync([Windows.UI.Notifications.NotificationKinds]::Toast)) `
                  ([System.Collections.Generic.IReadOnlyList[Windows.UI.Notifications.UserNotification]])
    foreach ($n in $list) {
      if ($script:notifSeen.ContainsKey($n.Id)) { continue }
      $script:notifSeen[$n.Id] = $true
      $texts = @()
      try {
        $b = $n.Notification.Visual.GetBinding([Windows.UI.Notifications.KnownNotificationBindings]::ToastGeneric)
        if ($b) { $texts = @($b.GetTextElements() | ForEach-Object { $_.Text } | Where-Object { $_ }) }
      } catch {}
      $app = ''; $appId = ''
      try { $app = $n.AppInfo.DisplayInfo.DisplayName; $appId = $n.AppInfo.AppUserModelId } catch {}
      if (-not $app) { $app = 'Notification' }
      if (-not $script:notifIcons.ContainsKey($app)) {
        $icon = $null
        try { $icon = Read-StreamRef ($n.AppInfo.DisplayInfo.GetLogo((New-Object Windows.Foundation.Size 48, 48))) } catch {}
        $script:notifIcons[$app] = $icon
      }
      Send @{
        type    = 'notif'
        id      = [int64]$n.Id
        app     = "$app"
        appId   = "$appId"
        title   = if ($texts.Count -gt 0) { "$($texts[0])" } else { '' }
        body    = if ($texts.Count -gt 1) { ($texts[1..($texts.Count - 1)] -join "`n") } else { '' }
        time    = [int64]$n.CreationTime.ToUnixTimeMilliseconds()
        icon    = $script:notifIcons[$app]
        initial = -not $script:notifPrimed
      }
    }
    $script:notifPrimed = $true
  } catch { }
}

# ---------------------------------------------------------------- per-app volume mixer
$procInfo = @{}
function Proc-Info([uint32]$procId) {
  if ($script:procInfo.ContainsKey($procId)) { return $script:procInfo[$procId] }
  $info = @{ name = "PID $procId"; path = '' }
  try {
    $p = Get-Process -Id $procId -ErrorAction Stop
    $info.name = $p.ProcessName
    try { $info.path = $p.MainModule.FileName } catch {}
    try { if ($p.Description) { $info.name = $p.Description } } catch {}
    if ($p.MainWindowTitle -and $p.ProcessName -eq 'ApplicationFrameHost') { $info.name = $p.MainWindowTitle }
  } catch {}
  $script:procInfo[$procId] = $info
  return $info
}
function Send-Mixer {
  if (-not $audioOk) { return }
  $apps = @()
  $seen = @{}
  foreach ($line in ([NotchMine.Audio]::Sessions() -split "`n")) {
    if (-not $line) { continue }
    $f = $line -split "`t"
    $procId = [uint32]$f[0]; $sys = $f[1] -eq '1'
    $key = if ($sys) { 'sys' } else { "$procId" }
    if ($seen.ContainsKey($key)) { continue }
    $seen[$key] = $true
    $pi = if ($sys) { @{ name = 'System sounds'; path = '' } } else { Proc-Info $procId }
    $apps += @{
      pid = [int64]$(if ($sys) { 0 } else { $procId }); system = $sys
      name = "$($pi.name)"; path = "$($pi.path)"
      volume = [double]$f[2]; muted = $f[3] -eq '1'; active = $f[4] -eq '1'
    }
  }
  Send @{ type = 'mixer'; apps = $apps }
}

# ---------------------------------------------------------------- privacy: who is using camera / microphone
$capBase = 'Software\Microsoft\Windows\CurrentVersion\CapabilityAccessManager\ConsentStore'
$lastPrivacy = ''
function Friendly-ConsentName([string]$key, [bool]$nonPackaged) {
  if ($nonPackaged) {
    $path = $key -replace '#', '\'
    try { $d = [System.Diagnostics.FileVersionInfo]::GetVersionInfo($path).FileDescription; if ($d) { return $d } } catch {}
    return [System.IO.Path]::GetFileNameWithoutExtension($path)
  }
  $n = ($key -split '_')[0]
  $n = ($n -split '\.')[-1]
  return ($n -creplace '([a-z])([A-Z])', '$1 $2')
}
function In-Use([string]$cap) {
  $names = @()
  $root = [Microsoft.Win32.Registry]::CurrentUser.OpenSubKey("$capBase\$cap")
  if (-not $root) { return $names }
  foreach ($sub in $root.GetSubKeyNames()) {
    if ($sub -eq 'NonPackaged') {
      $np = $root.OpenSubKey('NonPackaged')
      foreach ($k in $np.GetSubKeyNames()) {
        $s = $np.OpenSubKey($k)
        $start = $s.GetValue('LastUsedTimeStart'); $stop = $s.GetValue('LastUsedTimeStop')
        if ($start -and [int64]$start -gt 0 -and [int64]$stop -eq 0 -and $k -notmatch 'NotchMine') { $names += Friendly-ConsentName $k $true }
      }
    } else {
      $s = $root.OpenSubKey($sub)
      $start = $s.GetValue('LastUsedTimeStart'); $stop = $s.GetValue('LastUsedTimeStop')
      if ($start -and [int64]$start -gt 0 -and [int64]$stop -eq 0) { $names += Friendly-ConsentName $sub $false }
    }
  }
  return @($names | Select-Object -Unique)
}
function Poll-Privacy {
  try {
    $cam = @(In-Use 'webcam'); $mic = @(In-Use 'microphone')
    $k = ($cam -join ',') + '|' + ($mic -join ',')
    if ($k -ne $script:lastPrivacy) {
      $script:lastPrivacy = $k
      Send @{ type = 'privacy'; cam = $cam; mic = $mic }
    }
  } catch {}
}

# ---------------------------------------------------------------- which app is in front (for side mode)
$fgLast = ''
$fgProc = @{}
$trackH = [int64]0
$trackLast = -1
function Poll-Foreground {
  # the window side mode follows: report when it gets minimized / restored / closed
  if ($script:trackH -ne 0) {
    try {
      $ws = [NotchMine.Win]::WindowState($script:trackH)
      if ($ws -ne $script:trackLast) { $script:trackLast = $ws; Send @{ type = 'tracked'; hwnd = $script:trackH; state = $ws } }
    } catch {}
  }
  try {
    $info = [NotchMine.Win]::ForegroundInfo()
    if (-not $info -or $info -eq $script:fgLast) { return }
    $script:fgLast = $info
    $f = $info -split '\|'
    $hwnd = [int64]$f[0]
    $f = $f[1..($f.Count - 1)]
    $procId = [int]$f[0]
    if (-not $script:fgProc.ContainsKey($procId)) {
      $e = @{ exe = ''; name = ''; path = '' }
      try {
        $p = Get-Process -Id $procId -ErrorAction Stop
        $e.exe = "$($p.ProcessName).exe".ToLower()
        try { $e.path = $p.MainModule.FileName } catch {}
        if (-not $e.path) { try { $e.path = [NotchMine.Win]::ProcPath($procId) } catch {} }   # protected / elevated games
        $e.name = $p.ProcessName
        try { if ($p.Description) { $e.name = $p.Description } } catch {}
      } catch {}
      $script:fgProc[$procId] = $e
      if ($script:fgProc.Count -gt 200) { $script:fgProc = @{} }
    }
    $e = $script:fgProc[$procId]
    $script:fgPid = $procId
    $r = $f[2] -split ','
    Send @{ type = 'foreground'; hwnd = $hwnd; pid = $procId; exe = $e.exe; name = $e.name; path = $e.path; cls = $f[1]; l = [int]$r[0]; t = [int]$r[1]; r = [int]$r[2]; b = [int]$r[3]; max = ($f[3] -eq '1') }
  } catch {}
}

# ---------------------------------------------------------------- devices, keys, clipboard
$lastMic = $null; $lastOut = $null; $lastCaps = $null; $lastNum = $null; $lastClipSeq = $null
$drives = $null
function Poll-Devices {
  if ($audioOk) {
    try {
      $m = [NotchMine.Audio]::MicMuted()
      if ($m -ne $script:lastMic) { $script:lastMic = $m; Send @{ type = 'mic'; muted = ($m -eq 1); present = ($m -ge 0) } }
    } catch {}
    try {
      $o = [NotchMine.Audio]::OutputInfo()
      if ($o -ne $script:lastOut) {
        $initial = $null -eq $script:lastOut
        $script:lastOut = $o
        Send @{ type = 'audio-device'; name = ($o -split '\|', 2)[-1]; initial = $initial }
      }
    } catch {}
  }
}
function Poll-Keys {
  try {
    $c = [NotchMine.Win]::KeyToggled(0x14); $n = [NotchMine.Win]::KeyToggled(0x90)
    if ($null -ne $script:lastCaps -and $c -ne $script:lastCaps) { Send @{ type = 'lockkey'; key = 'Caps Lock'; on = $c } }
    if ($null -ne $script:lastNum -and $n -ne $script:lastNum) { Send @{ type = 'lockkey'; key = 'Num Lock'; on = $n } }
    $script:lastCaps = $c; $script:lastNum = $n
    $seq = [NotchMine.Win]::GetClipboardSequenceNumber()
    if ($null -ne $script:lastClipSeq -and $seq -ne $script:lastClipSeq) { Send @{ type = 'clipseq'; seq = [int64]$seq } }
    $script:lastClipSeq = $seq
  } catch {}
}
function Poll-Drives {
  try {
    $now = @{}
    foreach ($d in [System.IO.DriveInfo]::GetDrives()) {
      if ($d.DriveType -ne 'Removable' -or -not $d.IsReady) { continue }
      $now[$d.Name] = @{ letter = $d.Name.TrimEnd('\'); label = "$($d.VolumeLabel)"; size = [int64]$d.TotalSize; free = [int64]$d.AvailableFreeSpace }
    }
    if ($null -ne $script:drives) {
      foreach ($k in $now.Keys) { if (-not $script:drives.ContainsKey($k)) { $i = $now[$k]; Send @{ type = 'drive'; added = $true; letter = $i.letter; label = $i.label; size = $i.size; free = $i.free } } }
      foreach ($k in $script:drives.Keys) { if (-not $now.ContainsKey($k)) { $i = $script:drives[$k]; Send @{ type = 'drive'; added = $false; letter = $i.letter; label = $i.label } } }
    }
    $script:drives = $now
  } catch {}
}

# ---------------------------------------------------------------- OCR (Windows.Media.Ocr, fully offline)
function Do-Ocr([string]$id, [string]$path) {
  try {
    [void][Windows.Storage.StorageFile, Windows.Storage, ContentType = WindowsRuntime]
    [void][Windows.Media.Ocr.OcrEngine, Windows.Foundation, ContentType = WindowsRuntime]
    [void][Windows.Graphics.Imaging.SoftwareBitmap, Windows.Foundation, ContentType = WindowsRuntime]
    [void][Windows.Storage.Streams.RandomAccessStream, Windows.Storage.Streams, ContentType = WindowsRuntime]
    $file = Await ([Windows.Storage.StorageFile]::GetFileFromPathAsync($path)) ([Windows.Storage.StorageFile])
    $stream = Await ($file.OpenAsync([Windows.Storage.FileAccessMode]::Read)) ([Windows.Storage.Streams.IRandomAccessStream])
    $decoder = Await ([Windows.Graphics.Imaging.BitmapDecoder]::CreateAsync($stream)) ([Windows.Graphics.Imaging.BitmapDecoder])
    $bitmap = Await ($decoder.GetSoftwareBitmapAsync()) ([Windows.Graphics.Imaging.SoftwareBitmap])
    $engine = [Windows.Media.Ocr.OcrEngine]::TryCreateFromUserProfileLanguages()
    $result = Await ($engine.RecognizeAsync($bitmap)) ([Windows.Media.Ocr.OcrResult])
    $text = ($result.Lines | ForEach-Object { $_.Text }) -join "`n"
    $stream.Dispose()
    Send @{ type = 'ocr'; id = $id; text = $text }
  } catch { Send @{ type = 'ocr'; id = $id; text = ''; error = "$_" } }
}

function Handle-Command([string]$line) {
  $parts = $line.Trim() -split '\s+'
  if ($parts.Count -eq 0) { return }
  switch ($parts[0]) {
    'media' {
      $s = Get-Session
      if ($null -eq $s) { return }
      switch ($parts[1]) {
        'toggle' { [void](Await ($s.TryTogglePlayPauseAsync()) ([bool])) }
        'play'   { [void](Await ($s.TryPlayAsync()) ([bool])) }
        'pause'  { [void](Await ($s.TryPauseAsync()) ([bool])) }
        'next'   { [void](Await ($s.TrySkipNextAsync()) ([bool])) }
        'prev'   { [void](Await ($s.TrySkipPreviousAsync()) ([bool])) }
        'seek'   {
          $ticks = [int64]([double]$parts[2] * 10000000)
          [void](Await ($s.TryChangePlaybackPositionAsync($ticks)) ([bool]))
        }
      }
      Start-Sleep -Milliseconds 120
      Poll-Media $true
    }
    'vol' {
      if (-not $audioOk) { return }
      switch ($parts[1]) {
        'set'  { [NotchMine.Audio]::SetVolume([float]$parts[2]); if ([NotchMine.Audio]::GetMute()) { [NotchMine.Audio]::SetMute($false) } }
        'mute' { [NotchMine.Audio]::SetMute(-not [NotchMine.Audio]::GetMute()) }
      }
      Poll-Volume $true
    }
    'bright' {
      switch ($parts[1]) {
        'set' { Set-Brightness ([int]$parts[2]) }
      }
      Get-Brightness
    }
    'refresh' { Poll-Media $true; Poll-Volume $true }
    'mixer' {
      switch ($parts[1]) {
        'set'  { [NotchMine.Audio]::SetSession([uint32]$parts[2], [float]$parts[3], -1) }
        'mute' { [NotchMine.Audio]::SetSession([uint32]$parts[2], -1, 2) }
      }
      Send-Mixer
    }
    'games' { Send-Games }
    'track' {
      $script:trackH = [int64]$parts[1]
      $script:trackLast = -1
      Poll-Foreground
    }
    'mic' {
      switch ($parts[1]) {
        'toggle' { $m = [NotchMine.Audio]::MicMuted(); if ($m -ge 0) { [NotchMine.Audio]::SetMicMute($m -eq 0) } }
        'set'    { [NotchMine.Audio]::SetMicMute($parts[2] -eq '1') }
      }
      $script:lastMic = $null
      Poll-Devices
    }
    'ocr' {
      $rest = $line.Trim().Substring(4)
      $sp = $rest.IndexOf(' ')
      Do-Ocr $rest.Substring(0, $sp) $rest.Substring($sp + 1)
    }
    'notif' {
      $script:notifEnabled = ($parts[1] -eq 'on')
      if (-not $script:notifEnabled) { $script:notifPrimed = $false; $script:notifSeen = @{} }
      else { Poll-Notifications }
    }
  }
}

Send @{ type = 'ready'; media = $mediaOk; audio = $audioOk }
Poll-Media $true
Poll-Volume $true
Get-Brightness

$lastFs = $null
$notifStatus = ''
# NB: [Console]::In.ReadLineAsync() is secretly synchronous on .NET Framework,
# so read stdin through a real StreamReader to keep the poll loop running.
$stdin = New-Object System.IO.StreamReader ([Console]::OpenStandardInput()), ([System.Text.Encoding]::UTF8)
$pending = $stdin.ReadLineAsync()
$tick = 0
while ($true) {
  # Drain any commands that arrived
  while ($pending.IsCompleted) {
    $line = $pending.Result
    if ($null -eq $line) { exit 0 }   # Electron closed the pipe
    try { Handle-Command $line } catch { Log "command '$line' failed: $_" }
    $pending = $stdin.ReadLineAsync()
  }
  if ($tick % 3 -eq 0) { Poll-Media $false }
  Poll-Volume $false
  if ($tick % 5 -eq 2) { Poll-Network }
  if ($tick % 15 -eq 7) { Poll-Connection }
  if ($tick % 7 -eq 4) { Poll-Notifications }
  Poll-Keys
  if ($tick % 2 -eq 0) { Poll-Foreground }
  if ($tick % 5 -eq 1) { Poll-Privacy; Poll-Devices }
  if ($tick % 10 -eq 3) { Poll-Drives }
  if ($tick % 5 -eq 3) { Poll-Gpu }
  if ($audioOk -and $tick % 5 -eq 0) {
    try {
      $fsm = [NotchMine.Win]::ForegroundFullscreenMonitor()
      if ($fsm -ne $script:lastFs) { $script:lastFs = $fsm; Send @{ type = 'fullscreen'; value = ($fsm -ne ''); monitor = $fsm } }
    } catch {}
  }
  $tick++
  Start-Sleep -Milliseconds 200
}
