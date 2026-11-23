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
    // "l,t,r,b" of the monitor the foreground window fills, "" if it fills none, or "self" when NotchMine's own
    // window (the notch, Settings…) is in front: that says nothing about the movie behind it, so the caller keeps
    // what it had. (Clicking the notch, or Windows handing it the focus when a full-screen browser is minimized.)
    public static string ForegroundFullscreenMonitor(int appPid) {
      if (!dpi) { SetProcessDPIAware(); dpi = true; }
      IntPtr h = GetForegroundWindow();
      if (h == IntPtr.Zero) return "";
      uint fgPid; GetWindowThreadProcessId(h, out fgPid);
      if (appPid > 0 && fgPid == (uint)appPid) return "self";
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

# ---------------------------------------------------------------- live wallpaper: a window behind the desktop icons
# Windows 11 24H2+ ("raised desktop"): the icons (SHELLDLL_DefView) are a layered child of Progman, which has no
# drawing surface of its own, so the wallpaper window must be a *layered* child of Progman, placed right below the
# icons. Older Windows: the icons live in a WorkerW; Explorer makes a second WorkerW behind them on request (0x052C).
$deskSrc = @'
using System;
using System.Runtime.InteropServices;

namespace NotchMine {
  public static class Desk {
    [StructLayout(LayoutKind.Sequential)] struct RECT { public int L, T, R, B; }
    delegate bool EnumProc(IntPtr h, IntPtr l);
    [DllImport("user32.dll")] static extern bool SetProcessDPIAware();
    [DllImport("user32.dll")] static extern IntPtr FindWindow(string c, string t);
    [DllImport("user32.dll")] static extern IntPtr FindWindowEx(IntPtr p, IntPtr after, string c, string t);
    [DllImport("user32.dll")] static extern bool EnumWindows(EnumProc f, IntPtr l);
    [DllImport("user32.dll")] static extern IntPtr SetParent(IntPtr child, IntPtr parent);
    [DllImport("user32.dll")] static extern IntPtr GetParent(IntPtr h);
    [DllImport("user32.dll")] static extern bool IsWindow(IntPtr h);
    [DllImport("user32.dll")] static extern bool SetWindowPos(IntPtr h, IntPtr after, int x, int y, int cx, int cy, uint f);
    [DllImport("user32.dll")] static extern int GetWindowLong(IntPtr h, int i);
    [DllImport("user32.dll")] static extern int SetWindowLong(IntPtr h, int i, int v);
    [DllImport("user32.dll")] static extern bool GetWindowRect(IntPtr h, out RECT r);
    [DllImport("user32.dll")] static extern bool SetLayeredWindowAttributes(IntPtr h, uint key, byte alpha, uint flags);
    [DllImport("user32.dll")] static extern IntPtr SendMessageTimeout(IntPtr h, uint m, IntPtr w, IntPtr l, uint f, uint t, out IntPtr r);
    [DllImport("user32.dll")] static extern bool RedrawWindow(IntPtr h, IntPtr rc, IntPtr rgn, uint flags);
    const uint SWP_NOZORDER = 0x0004, SWP_NOACTIVATE = 0x0010, SWP_SHOWWINDOW = 0x0040;
    static bool dpi;
    static void Dpi() { if (!dpi) { SetProcessDPIAware(); dpi = true; } }

    [DllImport("user32.dll")] static extern IntPtr SetThreadDpiAwarenessContext(IntPtr ctx);
    // work in real pixels on every screen (the bridge is only "system" DPI aware, which scales windows on a
    // screen whose zoom differs from the main one: a 1920×1200 screen at 125% came out 1536×960)
    static IntPtr PerMonitor() { try { return SetThreadDpiAwarenessContext(new IntPtr(-4)); } catch { return IntPtr.Zero; } }
    static void Restore(IntPtr old) { if (old != IntPtr.Zero) { try { SetThreadDpiAwarenessContext(old); } catch { } } }

    // where the wallpaper goes: (parent, the window to sit right below, "raised" | "classic"), or parent = 0.
    // First ask Explorer (0x052C) to draw the wallpaper in a WorkerW of its own. Without that, on the raised desktop
    // the icon layer paints the normal wallpaper itself, opaquely, and covers ours.
    static IntPtr Host(out IntPtr after, out IntPtr worker, out string mode) {
      after = IntPtr.Zero; worker = IntPtr.Zero; mode = "";
      IntPtr pm = FindWindow("Progman", null);
      if (pm == IntPtr.Zero) return IntPtr.Zero;
      IntPtr r;
      SendMessageTimeout(pm, 0x052C, new IntPtr(0xD), new IntPtr(1), 0, 1000, out r);
      SendMessageTimeout(pm, 0x052C, IntPtr.Zero, IntPtr.Zero, 0, 1000, out r);
      IntPtr dv = FindWindowEx(pm, IntPtr.Zero, "SHELLDLL_DefView", null);
      if (dv != IntPtr.Zero) {                                     // Windows 11 24H2+: icons, ours, then Explorer's wallpaper
        after = dv; worker = FindWindowEx(pm, IntPtr.Zero, "WorkerW", null); mode = "raised"; return pm;
      }
      IntPtr ww = IntPtr.Zero;
      EnumWindows((t, l) => {
        if (FindWindowEx(t, IntPtr.Zero, "SHELLDLL_DefView", null) != IntPtr.Zero) ww = FindWindowEx(IntPtr.Zero, t, "WorkerW", null);
        return true;
      }, IntPtr.Zero);
      if (ww == IntPtr.Zero) return IntPtr.Zero;
      mode = "classic"; return ww;
    }
    static void Place(IntPtr me, IntPtr parent, IntPtr after, int x, int y, int w, int h) {
      RECT pr; GetWindowRect(parent, out pr);                       // the parent spans every screen; x/y are screen pixels
      SetWindowPos(me, after, x - pr.L, y - pr.T, w, h, SWP_NOACTIVATE | SWP_SHOWWINDOW | (after == IntPtr.Zero ? SWP_NOZORDER : 0));
    }
    // returns "raised" / "classic", or "" if the desktop couldn't be found
    public static string Attach(long hwnd, int x, int y, int w, int h) {
      Dpi();
      IntPtr me = new IntPtr(hwnd);
      if (!IsWindow(me)) return "";
      IntPtr old = PerMonitor();
      try {
        IntPtr after, worker; string mode;
        IntPtr parent = Host(out after, out worker, out mode);
        if (parent == IntPtr.Zero) return "";
        SetWindowLong(me, -16, (GetWindowLong(me, -16) & ~unchecked((int)0x80000000)) | 0x40000000);   // WS_POPUP → WS_CHILD
        SetWindowLong(me, -20, GetWindowLong(me, -20) | 0x80000);                                      // WS_EX_LAYERED
        SetLayeredWindowAttributes(me, 0, 255, 2);                                                       // fully opaque
        SetParent(me, parent);
        Place(me, parent, after, x, y, w, h);
        // Explorer's wallpaper at the very bottom, behind ours (and behind every other screen's)
        if (worker != IntPtr.Zero) SetWindowPos(worker, new IntPtr(1), 0, 0, 0, 0, 0x0001 | 0x0002 | SWP_NOACTIVATE);
        return mode;
      } finally { Restore(old); }
    }
    // watchdog while the live wallpaper is on: "" when the taskbar and the desktop answer, else which one didn't
    public static string Hung() {
      IntPtr r;
      IntPtr tb = FindWindow("Shell_TrayWnd", null);
      if (tb != IntPtr.Zero && SendMessageTimeout(tb, 0, IntPtr.Zero, IntPtr.Zero, 0x0002, 2000, out r) == IntPtr.Zero) return "taskbar";   // WM_NULL, SMTO_ABORTIFHUNG
      IntPtr pm = FindWindow("Progman", null);
      if (pm != IntPtr.Zero && SendMessageTimeout(pm, 0, IntPtr.Zero, IntPtr.Zero, 0x0002, 2000, out r) == IntPtr.Zero) return "desktop";
      return "";
    }
    // ask the desktop to repaint (after a wallpaper window goes away, so the normal wallpaper shows at once)
    public static void Refresh() {
      IntPtr pm = FindWindow("Progman", null);
      if (pm != IntPtr.Zero) RedrawWindow(pm, IntPtr.Zero, IntPtr.Zero, 0x0001 | 0x0004 | 0x0080 | 0x0100);   // INVALIDATE | ERASE | ALLCHILDREN | UPDATENOW
    }
  }
}
'@
$deskOk = $true
try { Add-Type -TypeDefinition $deskSrc -Language CSharp } catch { $deskOk = $false; Log "desktop init failed: $_" }

# ---------------------------------------------------------------- NotchMine taskbar (dock): the Windows taskbar, open windows
# Hide: the Windows taskbar is set to auto-hide (so it gives its strip of screen back) and its windows are hidden;
# Show puts both back exactly as they were. The dock registers as an "app bar", so maximized windows stop above it.
$barSrc = @'
using System;
using System.Text;
using System.Collections.Generic;
using System.Runtime.InteropServices;

namespace NotchMine {
  [StructLayout(LayoutKind.Sequential, Pack = 4)] public struct BarPropKey { public Guid fmtid; public uint pid; }
  [StructLayout(LayoutKind.Sequential)] public struct BarPropVariant { public ushort vt; public ushort r1, r2, r3; public IntPtr p; public IntPtr p2; }   // 24 bytes, like the real one
  [ComImport, Guid("886D8EEB-8CF2-4446-8D02-CDBA1DBDCF99"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  public interface IBarPropertyStore {
    [PreserveSig] int GetCount(out uint c);
    [PreserveSig] int GetAt(uint i, out BarPropKey k);
    [PreserveSig] int GetValue(ref BarPropKey k, out BarPropVariant v);
    [PreserveSig] int SetValue(ref BarPropKey k, ref BarPropVariant v);
    [PreserveSig] int Commit();
  }
  [StructLayout(LayoutKind.Sequential)] public struct BarSize { public int cx, cy; }
  [ComImport, Guid("bcc18b79-ba16-442f-80c4-8a59c30c463b"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  public interface IBarImageFactory { [PreserveSig] int GetImage(BarSize size, int flags, out IntPtr hbm); }
  public static class Bar {
    [StructLayout(LayoutKind.Sequential)] public struct RECT { public int L, T, R, B; }
    [DllImport("shell32.dll", CharSet = CharSet.Unicode)] static extern int SHCreateItemFromParsingName(string path, IntPtr pbc, ref Guid riid, [MarshalAs(UnmanagedType.Interface)] out IBarImageFactory item);
    [DllImport("gdi32.dll")] static extern bool DeleteObject(IntPtr h);
    // a Store app's icon (WhatsApp, Teams…) by its app ID, as Start shows it; keeps the transparency
    public static string AppIconPng(string aumid, int size) {
      try {
        Guid iid = typeof(IBarImageFactory).GUID; IBarImageFactory f;
        if (SHCreateItemFromParsingName("shell:AppsFolder\\" + aumid, IntPtr.Zero, ref iid, out f) != 0 || f == null) return "";
        try {
          IntPtr hbm; var sz = new BarSize(); sz.cx = size; sz.cy = size;
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
    [DllImport("shell32.dll")] static extern int SHGetPropertyStoreForWindow(IntPtr h, ref Guid iid, [MarshalAs(UnmanagedType.Interface)] out IBarPropertyStore ps);
    [DllImport("shell32.dll", CharSet = CharSet.Unicode)] static extern int SHGetPropertyStoreFromParsingName(string path, IntPtr bc, int flags, ref Guid iid, [MarshalAs(UnmanagedType.Interface)] out IBarPropertyStore ps);
    [DllImport("ole32.dll")] static extern int PropVariantClear(ref BarPropVariant v);
    // the "app ID" Windows uses to put windows on taskbar buttons (Chrome profiles and web apps each have their own)
    static string Aumid(IBarPropertyStore ps) {
      var k = new BarPropKey { fmtid = new Guid("9F4C2855-9F79-4B39-A8D0-E1D42DE1D5F3"), pid = 5 };
      BarPropVariant v;
      if (ps.GetValue(ref k, out v) != 0) return "";
      string s = v.vt == 31 && v.p != IntPtr.Zero ? Marshal.PtrToStringUni(v.p) : "";
      PropVariantClear(ref v);
      return s ?? "";
    }
    static Dictionary<long, string> winIds = new Dictionary<long, string>();
    static string WindowAumid(IntPtr h) {
      string id;
      if (winIds.TryGetValue(h.ToInt64(), out id)) return id;
      id = "";
      try {
        Guid iid = typeof(IBarPropertyStore).GUID; IBarPropertyStore ps;
        if (SHGetPropertyStoreForWindow(h, ref iid, out ps) == 0 && ps != null) { try { id = Aumid(ps); } finally { Marshal.ReleaseComObject(ps); } }
      } catch { }
      if (winIds.Count > 500) winIds.Clear();
      winIds[h.ToInt64()] = id;
      return id;
    }
    public static string FileAumid(string path) {
      try {
        Guid iid = typeof(IBarPropertyStore).GUID; IBarPropertyStore ps;
        if (SHGetPropertyStoreFromParsingName(path, IntPtr.Zero, 0, ref iid, out ps) == 0 && ps != null) { try { return Aumid(ps); } finally { Marshal.ReleaseComObject(ps); } }
      } catch { }
      return "";
    }
    [StructLayout(LayoutKind.Sequential)] struct APPBARDATA { public int cbSize; public IntPtr hWnd; public uint msg; public uint edge; public RECT rc; public IntPtr lParam; }
    delegate bool EnumProc(IntPtr h, IntPtr l);
    [DllImport("shell32.dll")] static extern UIntPtr SHAppBarMessage(uint msg, ref APPBARDATA d);
    [DllImport("user32.dll")] static extern bool SetProcessDPIAware();
    [DllImport("user32.dll")] static extern IntPtr FindWindow(string c, string t);
    [DllImport("user32.dll")] static extern IntPtr FindWindowEx(IntPtr p, IntPtr after, string c, string t);
    [DllImport("user32.dll")] static extern bool EnumWindows(EnumProc f, IntPtr l);
    [DllImport("user32.dll")] static extern bool ShowWindow(IntPtr h, int cmd);
    [DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr h);
    [DllImport("user32.dll")] static extern bool IsIconic(IntPtr h);
    [DllImport("user32.dll")] static extern IntPtr GetWindow(IntPtr h, uint cmd);
    [DllImport("user32.dll")] static extern int GetWindowLong(IntPtr h, int i);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern int GetWindowText(IntPtr h, StringBuilder s, int n);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern int GetClassName(IntPtr h, StringBuilder s, int n);
    [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
    [DllImport("user32.dll")] static extern IntPtr GetForegroundWindow();
    [DllImport("user32.dll")] static extern bool SetForegroundWindow(IntPtr h);
    [DllImport("user32.dll")] static extern bool BringWindowToTop(IntPtr h);
    [DllImport("user32.dll")] static extern bool AttachThreadInput(uint a, uint b, bool attach);
    [DllImport("kernel32.dll")] static extern uint GetCurrentThreadId();
    [DllImport("user32.dll")] static extern bool PostMessage(IntPtr h, uint m, IntPtr w, IntPtr l);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern uint PrivateExtractIcons(string file, int index, int cx, int cy, IntPtr[] icons, uint[] ids, uint n, uint flags);
    [DllImport("user32.dll")] static extern bool DestroyIcon(IntPtr h);
    // an app's icon at the size the dock draws it (works for .exe, .dll and .ico, like the Windows taskbar does)
    public static string IconPng(string file, int index, int size) {
      file = Environment.ExpandEnvironmentVariables(file);
      var h = new IntPtr[1]; var id = new uint[1];
      uint got = PrivateExtractIcons(file, index, size, size, h, id, 1, 0);
      if (got == 0 || got == 0xFFFFFFFF || h[0] == IntPtr.Zero) return "";
      try {
        using (var ic = System.Drawing.Icon.FromHandle(h[0]))
        using (var bmp = ic.ToBitmap())
        using (var ms = new System.IO.MemoryStream()) { bmp.Save(ms, System.Drawing.Imaging.ImageFormat.Png); return Convert.ToBase64String(ms.ToArray()); }
      } finally { DestroyIcon(h[0]); }
    }
    [DllImport("user32.dll")] static extern void keybd_event(byte vk, byte scan, uint flags, UIntPtr extra);
    [DllImport("dwmapi.dll")] static extern int DwmGetWindowAttribute(IntPtr h, int attr, out int v, int size);
    [DllImport("kernel32.dll")] static extern IntPtr OpenProcess(uint access, bool inherit, int pid);
    [DllImport("kernel32.dll")] static extern bool CloseHandle(IntPtr h);
    [DllImport("kernel32.dll", CharSet = CharSet.Unicode)] static extern bool QueryFullProcessImageName(IntPtr h, int flags, StringBuilder s, ref int n);
    const uint ABM_NEW = 0, ABM_REMOVE = 1, ABM_QUERYPOS = 2, ABM_SETPOS = 3, ABM_GETSTATE = 4, ABM_SETSTATE = 10;
    static bool dpi; static void Dpi() { if (!dpi) { SetProcessDPIAware(); dpi = true; } }

    // ---- hiding / showing the Windows taskbar
    public static bool Hidden;
    static int origState = -1;
    static List<IntPtr> Trays() {
      var l = new List<IntPtr>();
      IntPtr t = FindWindow("Shell_TrayWnd", null); if (t != IntPtr.Zero) l.Add(t);
      IntPtr s = IntPtr.Zero;
      while ((s = FindWindowEx(IntPtr.Zero, s, "Shell_SecondaryTrayWnd", null)) != IntPtr.Zero) l.Add(s);
      return l;
    }
    static void SetState(int state) {
      var d = new APPBARDATA(); d.cbSize = Marshal.SizeOf(typeof(APPBARDATA));
      d.hWnd = FindWindow("Shell_TrayWnd", null); d.lParam = new IntPtr(state);
      SHAppBarMessage(ABM_SETSTATE, ref d);
    }
    static int GetState() {
      var d = new APPBARDATA(); d.cbSize = Marshal.SizeOf(typeof(APPBARDATA));
      d.hWnd = FindWindow("Shell_TrayWnd", null);
      return (int)SHAppBarMessage(ABM_GETSTATE, ref d).ToUInt32();
    }
    // returns the taskbar's own setting from before (auto-hide or not), so it can be put back even after a crash
    public static int Hide(int known) {
      if (!Hidden) { origState = known >= 0 ? known : GetState(); Hidden = true; }
      SetState(1);                                                   // ABS_AUTOHIDE: frees the strip of screen
      foreach (var t in Trays()) ShowWindow(t, 0);                   // SW_HIDE
      return origState;
    }
    // after a crash: put the remembered setting back and show the taskbar
    public static void Restore(int state) { SetState(state); Hidden = false; foreach (var t in Trays()) ShowWindow(t, 5); }
    // the taskbar likes to come back (Start menu, Explorer restart, a new screen): hide it again
    public static void Keep() {
      if (!Hidden) return;
      foreach (var t in Trays()) if (IsWindowVisible(t)) ShowWindow(t, 0);
    }
    public static void Show() {
      if (Hidden) { SetState(origState < 0 ? 2 : origState); Hidden = false; }
      foreach (var t in Trays()) ShowWindow(t, 5);                   // SW_SHOW
    }
    // "peek": show the real taskbar for a moment (to reach tray icons), Keep() hides it again later
    public static void Peek() { foreach (var t in Trays()) ShowWindow(t, 5); }

    // ---- where Windows opens Start and search. Both follow the (hidden) Windows taskbar's own layout, not ours:
    // its alignment (TaskbarAl: 0 left, 1 centre) and its search button (SearchboxTaskbarMode: 1 icon, 2 box).
    // With the search box, Win+S types into the Windows box itself, drawn over our bar at its own spot. So:
    //   full-width bar: left + box   → Start opens at the left; the Windows box lands exactly on our Search pill
    //   the docks:      centre + icon → Start and search open centred above the dock; search types in its own panel
    // Explorer picks both up at once. The user's own values are put back when ours goes away (-1 = wasn't set).
    const string ADV = @"Software\Microsoft\Windows\CurrentVersion\Explorer\Advanced", SRCH = @"Software\Microsoft\Windows\CurrentVersion\Search";
    static int origAl = -2, origMode = -2;                           // -2: nothing changed by us
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern IntPtr SendMessageTimeout(IntPtr h, uint m, UIntPtr w, string l, uint f, uint t, out UIntPtr r);
    static int ReadDw(string key, string name) {
      using (var k = Microsoft.Win32.Registry.CurrentUser.OpenSubKey(key)) { object v = k == null ? null : k.GetValue(name); return v is int ? (int)v : -1; }
    }
    static void WriteDw(string key, string name, int v) {
      using (var k = Microsoft.Win32.Registry.CurrentUser.CreateSubKey(key)) {
        if (v < 0) k.DeleteValue(name, false); else k.SetValue(name, v, Microsoft.Win32.RegistryValueKind.DWord);
      }
    }
    static void TrayNotify() { UIntPtr r; SendMessageTimeout(new IntPtr(0xFFFF), 0x001A, UIntPtr.Zero, "TraySettings", 2, 1000, out r); }   // WM_SETTINGCHANGE, SMTO_ABORTIFHUNG
    // returns "al mode": the user's own values, for main.js to keep (so they can be put back even after a crash)
    public static string Layout(int al, int mode, int knownAl, int knownMode) {
      if (origAl == -2) {
        origAl = knownAl >= -1 ? knownAl : ReadDw(ADV, "TaskbarAl");
        origMode = knownMode >= -1 ? knownMode : ReadDw(SRCH, "SearchboxTaskbarMode");
      }
      bool changed = false;
      if (ReadDw(ADV, "TaskbarAl") != al) { WriteDw(ADV, "TaskbarAl", al); changed = true; }
      if (ReadDw(SRCH, "SearchboxTaskbarMode") != mode) { WriteDw(SRCH, "SearchboxTaskbarMode", mode); changed = true; }
      if (changed) TrayNotify();
      return origAl + " " + origMode;
    }
    public static void LayoutRestore(int al, int mode) {
      WriteDw(ADV, "TaskbarAl", al); WriteDw(SRCH, "SearchboxTaskbarMode", mode); TrayNotify();
      origAl = origMode = -2;
    }
    public static void LayoutBack() { if (origAl != -2) LayoutRestore(origAl, origMode); }

    // ---- the dock as an app bar: maximized windows stop above it
    public static void AppBar(long hwnd, int l, int t, int r, int b) {
      Dpi();
      var d = new APPBARDATA(); d.cbSize = Marshal.SizeOf(typeof(APPBARDATA)); d.hWnd = new IntPtr(hwnd);
      d.msg = 0x8000 + 0x4E4D;                                       // WM_APP + 'NM' (we don't need the callbacks)
      SHAppBarMessage(ABM_NEW, ref d);
      d.edge = 3; d.rc.L = l; d.rc.T = t; d.rc.R = r; d.rc.B = b;    // ABE_BOTTOM
      SHAppBarMessage(ABM_QUERYPOS, ref d);
      d.rc.T = d.rc.B - (b - t);
      SHAppBarMessage(ABM_SETPOS, ref d);
    }
    public static void AppBarOff(long hwnd) {
      var d = new APPBARDATA(); d.cbSize = Marshal.SizeOf(typeof(APPBARDATA)); d.hWnd = new IntPtr(hwnd);
      SHAppBarMessage(ABM_REMOVE, ref d);
    }

    // ---- open windows (what Alt+Tab would show): "hwnd \t pid \t exe path \t minimized \t app id \t title" per line
    static Dictionary<uint, string> paths = new Dictionary<uint, string>();
    static string PathOf(uint pid) {
      string p;
      if (paths.TryGetValue(pid, out p)) return p;
      p = "";
      IntPtr h = OpenProcess(0x1000, false, (int)pid);
      if (h != IntPtr.Zero) { var sb = new StringBuilder(1024); int n = sb.Capacity; if (QueryFullProcessImageName(h, 0, sb, ref n)) p = sb.ToString(); CloseHandle(h); }
      if (paths.Count > 300) paths.Clear();
      paths[pid] = p;
      return p;
    }
    static readonly string[] skip = { "Progman", "WorkerW", "Shell_TrayWnd", "Shell_SecondaryTrayWnd", "Windows.UI.Core.CoreWindow", "XamlExplorerHostIslandWindow", "TopLevelWindowForOverflowXamlIsland" };
    public static string Tasks(long selfPid) {
      var sb = new StringBuilder();
      EnumWindows((h, l) => {
        if (!IsWindowVisible(h) || GetWindow(h, 4) != IntPtr.Zero) return true;            // hidden, or owned by another window
        int ex = GetWindowLong(h, -20);
        if ((ex & 0x80) != 0 && (ex & 0x40000) == 0) return true;                          // tool window (unless WS_EX_APPWINDOW)
        int cloaked; if (DwmGetWindowAttribute(h, 14, out cloaked, 4) == 0 && cloaked != 0) return true;   // other virtual desktop / suspended app
        var t = new StringBuilder(256); if (GetWindowText(h, t, 256) == 0) return true;
        var c = new StringBuilder(128); GetClassName(h, c, 128);
        if (Array.IndexOf(skip, c.ToString()) >= 0) return true;
        uint pid; GetWindowThreadProcessId(h, out pid);
        if (pid == selfPid) return true;
        string title = t.ToString().Replace('\t', ' ').Replace('\n', ' ');
        sb.Append(h.ToInt64()).Append('\t').Append(pid).Append('\t').Append(PathOf(pid)).Append('\t').Append(IsIconic(h) ? 1 : 0).Append('\t').Append(WindowAumid(h)).Append('\t').Append(title).Append('\n');
        return true;
      }, IntPtr.Zero);
      return sb.ToString();
    }

    // ---- window actions
    public static void Activate(long hwnd) {
      IntPtr w = new IntPtr(hwnd);
      if (IsIconic(w)) ShowWindow(w, 9);                                                     // SW_RESTORE
      if (SetForegroundWindow(w) && GetForegroundWindow() == w) return;
      uint pid, fg = GetWindowThreadProcessId(GetForegroundWindow(), out pid), me = GetCurrentThreadId();
      AttachThreadInput(me, fg, true);
      BringWindowToTop(w); SetForegroundWindow(w);
      AttachThreadInput(me, fg, false);
      if (GetForegroundWindow() != w) { keybd_event(0x12, 0, 0, UIntPtr.Zero); keybd_event(0x12, 0, 2, UIntPtr.Zero); SetForegroundWindow(w); }
    }
    public static void Minimize(long hwnd) { ShowWindow(new IntPtr(hwnd), 6); }                // SW_MINIMIZE
    public static void Close(long hwnd) { PostMessage(new IntPtr(hwnd), 0x0010, IntPtr.Zero, IntPtr.Zero); }   // WM_CLOSE
    // Windows shortcuts: Start, search, task view, quick settings, notifications
    public static void Keys(string what) {
      byte k = 0;
      if (what == "search") k = 0x53; else if (what == "taskview") k = 0x09; else if (what == "quick") k = 0x41; else if (what == "notif") k = 0x4E;
      keybd_event(0x5B, 0, 0, UIntPtr.Zero);                                                 // Win down
      if (k != 0) { keybd_event(k, 0, 0, UIntPtr.Zero); keybd_event(k, 0, 2, UIntPtr.Zero); }
      keybd_event(0x5B, 0, 2, UIntPtr.Zero);                                                 // Win up
    }
  }

  // stdin on its own thread. Clicks on the dock (open / minimize / close a window, Start, search…) run right away
  // instead of waiting for the poll loop, which can be held up for seconds by a slow app (a WinRT media call, a hung
  // window). Everything else is queued for the loop, in order.
  public static class Input {
    static readonly System.Collections.Concurrent.ConcurrentQueue<string> q = new System.Collections.Concurrent.ConcurrentQueue<string>();
    static volatile bool closed;
    public static bool Closed { get { return closed; } }
    public static void Start() {
      var t = new System.Threading.Thread(() => {
        try {
          var r = new System.IO.StreamReader(Console.OpenStandardInput(), new UTF8Encoding(false));
          string line;
          while ((line = r.ReadLine()) != null) { if (!Fast(line)) q.Enqueue(line); }
        } catch { }
        closed = true;
      });
      t.IsBackground = true;
      t.Start();
    }
    public static string Next() { string s; return q.TryDequeue(out s) ? s : null; }
    static bool Fast(string line) {
      var p = line.Trim().Split(' ');
      if (p.Length != 3) return false;
      if (p[0] == "win") {
        long h;
        if (!long.TryParse(p[2], out h) || (p[1] != "activate" && p[1] != "min" && p[1] != "close")) return false;
        string act = p[1];
        // a thread-pool thread each, so one window that doesn't answer can't hold up the next click
        System.Threading.ThreadPool.QueueUserWorkItem(_ => {
          try { if (act == "activate") Bar.Activate(h); else if (act == "min") Bar.Minimize(h); else Bar.Close(h); } catch { }
          System.Threading.Thread.Sleep(60);
          q.Enqueue("win-done");                                       // the loop refreshes the window list
        });
        return true;
      }
      if (p[0] == "tb" && p[1] == "key") {
        string k = p[2];
        System.Threading.ThreadPool.QueueUserWorkItem(_ => { try { Bar.Keys(k); } catch { } });
        return true;
      }
      return false;
    }
  }
}
'@
$barOk = $true
try { Add-Type -TypeDefinition $barSrc -Language CSharp -ReferencedAssemblies System.Drawing } catch { $barOk = $false; Log "taskbar init failed: $_" }
$script:tasksOn = $false
$script:tasksLast = ''
function Poll-Tasks {
  if (-not $script:tasksOn -or -not $barOk) { return }
  try {
    $t = [NotchMine.Bar]::Tasks([int64]$PID)
    if ($t -eq $script:tasksLast) { return }
    $script:tasksLast = $t
    $list = @()
    foreach ($ln in ($t -split "`n")) {
      if (-not $ln) { continue }
      $f = $ln -split "`t", 6
      $list += @{ hwnd = $f[0]; pid = [int]$f[1]; path = $f[2]; min = ($f[3] -eq '1'); aumid = $f[4]; title = $f[5] }
    }
    Send @{ type = 'tasks'; list = $list }
  } catch { Log "tasks failed: $_" }
}
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
    'tb' {
      if (-not $barOk) { return }
      switch ($parts[1]) {
        'hide'   { $o = [NotchMine.Bar]::Hide($(if ($parts.Count -gt 2) { [int]$parts[2] } else { -1 })); Send @{ type = 'tb-hidden'; orig = $o } }
        'restore' { [NotchMine.Bar]::Restore([int]$parts[2]) }
        'show'   { [NotchMine.Bar]::Show() }
        'peek'   { [NotchMine.Bar]::Peek(); $script:peekUntil = (Get-Date).AddSeconds(8) }
        'appbar' { [NotchMine.Bar]::AppBar([int64]$parts[2], [int]$parts[3], [int]$parts[4], [int]$parts[5], [int]$parts[6]) }
        'appbar-off' { [NotchMine.Bar]::AppBarOff([int64]$parts[2]) }
        'tasks'  { $script:tasksOn = ($parts[2] -eq 'on'); $script:tasksLast = ''; Poll-Tasks }
        'key'    { [NotchMine.Bar]::Keys($parts[2]) }
        'layout' {
          $o = [NotchMine.Bar]::Layout([int]$parts[2], [int]$parts[3], [int]$parts[4], [int]$parts[5]) -split ' '
          Send @{ type = 'tb-layout'; al = [int]$o[0]; mode = [int]$o[1] }
        }
        'layout-restore' { [NotchMine.Bar]::LayoutRestore([int]$parts[2], [int]$parts[3]) }
        'layout-back' { [NotchMine.Bar]::LayoutBack() }
      }
    }
    'aumid' {
      # aumid <id> <shortcut path, may contain spaces>: the app ID a pinned shortcut belongs to
      if (-not $barOk) { return }
      $m = [regex]::Match($line.Trim(), '^aumid\s+(\S+)\s+(.+)$')
      if ($m.Success) { Send @{ type = 'aumid'; id = $m.Groups[1].Value; value = [NotchMine.Bar]::FileAumid($m.Groups[2].Value) } }
    }
    'icon' {
      # icon <id> <index> <file path, may contain spaces>
      if (-not $barOk) { return }
      $m = [regex]::Match($line.Trim(), '^icon\s+(\S+)\s+(-?\d+)\s+(.+)$')
      if ($m.Success) { Send @{ type = 'icon'; id = $m.Groups[1].Value; data = [NotchMine.Bar]::IconPng($m.Groups[3].Value, [int]$m.Groups[2].Value, 48) } }
    }
    'appicon' {
      # appicon <id> <Store app ID>: its icon, as Start shows it
      if (-not $barOk) { return }
      $m = [regex]::Match($line.Trim(), '^appicon\s+(\S+)\s+(\S+)$')
      if ($m.Success) { Send @{ type = 'icon'; id = $m.Groups[1].Value; data = [NotchMine.Bar]::AppIconPng($m.Groups[2].Value, 48) } }
    }
    'win' {
      if (-not $barOk) { return }
      switch ($parts[1]) {
        'activate' { [NotchMine.Bar]::Activate([int64]$parts[2]) }
        'min'      { [NotchMine.Bar]::Minimize([int64]$parts[2]) }
        'close'    { [NotchMine.Bar]::Close([int64]$parts[2]) }
      }
      Start-Sleep -Milliseconds 60
      Poll-Tasks
      Poll-Foreground
    }
    'win-done' { Poll-Tasks; Poll-Foreground }                    # a dock click ran on the input thread (Input.Fast)
    'wp' {
      if (-not $deskOk) { Send @{ type = 'wp-attached'; hwnd = $parts[2]; mode = '' }; return }
      switch ($parts[1]) {
        'attach' {
          $m = [NotchMine.Desk]::Attach([int64]$parts[2], [int]$parts[3], [int]$parts[4], [int]$parts[5], [int]$parts[6])
          Send @{ type = 'wp-attached'; hwnd = $parts[2]; mode = $m }
        }
        'refresh' { [NotchMine.Desk]::Refresh() }
        'watch' { $script:wpWatch = ($parts[2] -eq 'on'); $script:wpHangs = 0 }
      }
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
$appPid = 0                            # NotchMine's own process (main.js passes it): its windows don't count as "left full-screen"
try { $appPid = [int]$env:NOTCHMINE_PID } catch {}
$notifStatus = ''
# stdin: with the taskbar code loaded, a thread of its own (NotchMine.Input: dock clicks run at once, the rest is
# queued for this loop). Without it, a StreamReader polled here. NB: [Console]::In.ReadLineAsync() is secretly
# synchronous on .NET Framework, hence the real StreamReader.
$fastInput = $false
if ($barOk) { try { [NotchMine.Input]::Start(); $fastInput = $true } catch { Log "input thread failed: $_" } }
if (-not $fastInput) {
  $stdin = New-Object System.IO.StreamReader ([Console]::OpenStandardInput()), ([System.Text.Encoding]::UTF8)
  $pending = $stdin.ReadLineAsync()
}
function Quit-Bridge {                 # Electron closed the pipe (NotchMine quit or crashed):
  if ($barOk -and [NotchMine.Bar]::Hidden) { [NotchMine.Bar]::Show() }   # never leave anyone without a taskbar
  if ($barOk) { try { [NotchMine.Bar]::LayoutBack() } catch { } }        # nor with our Start / search layout
  exit 0
}
# a check that holds the loop up for more than a second is logged (it delays everything else the bridge does)
$sw = [System.Diagnostics.Stopwatch]::new()
function Slow([string]$what) { if ($sw.ElapsedMilliseconds -gt 1000) { Log "slow: $what took $($sw.ElapsedMilliseconds) ms" } }
$tick = 0
while ($true) {
  # Drain any commands that arrived
  if ($fastInput) {
    $closed = [NotchMine.Input]::Closed                             # read first: lines before the end are queued by then
    while ($null -ne ($line = [NotchMine.Input]::Next())) {
      $sw.Restart()
      try { Handle-Command $line } catch { Log "command '$line' failed: $_" }
      Slow "command '$(($line -split ' ')[0..1] -join ' ')'"
    }
    if ($closed) { Quit-Bridge }
  } else {
    while ($pending.IsCompleted) {
      $line = $pending.Result
      if ($null -eq $line) { Quit-Bridge }
      try { Handle-Command $line } catch { Log "command '$line' failed: $_" }
      $pending = $stdin.ReadLineAsync()
    }
  }
  if ($tick % 3 -eq 0) { $sw.Restart(); Poll-Media $false; Slow 'media' }
  $sw.Restart(); Poll-Volume $false; Slow 'volume'
  if ($tick % 5 -eq 2) { $sw.Restart(); Poll-Network; Slow 'network' }
  if ($tick % 15 -eq 7) { $sw.Restart(); Poll-Connection; Slow 'connection' }
  if ($tick % 7 -eq 4) { $sw.Restart(); Poll-Notifications; Slow 'notifications' }
  Poll-Keys
  if ($tick % 2 -eq 0) { $sw.Restart(); Poll-Foreground; Slow 'foreground' }
  if ($tick % 2 -eq 1) { $sw.Restart(); Poll-Tasks; Slow 'tasks' }
  if ($barOk -and [NotchMine.Bar]::Hidden -and ((-not $script:peekUntil) -or (Get-Date) -gt $script:peekUntil)) { [NotchMine.Bar]::Keep() }
  if ($tick % 5 -eq 1) { $sw.Restart(); Poll-Privacy; Slow 'privacy'; $sw.Restart(); Poll-Devices; Slow 'devices' }
  if ($tick % 10 -eq 3) { $sw.Restart(); Poll-Drives; Slow 'drives' }
  # live wallpaper on: two missed answers in a row (about 4 s) from the taskbar or the desktop → main switches it off
  if ($script:wpWatch -and $deskOk -and $tick % 10 -eq 6) {
    $h = [NotchMine.Desk]::Hung()
    if ($h) { $script:wpHangs++; if ($script:wpHangs -ge 2) { Send @{ type = 'wp-hang'; what = $h }; $script:wpWatch = $false } }
    else { $script:wpHangs = 0 }
  }
  if ($tick % 5 -eq 3) { $sw.Restart(); Poll-Gpu; Slow 'gpu' }
  if ($audioOk -and $tick % 5 -eq 0) {
    try {
      $fsm = [NotchMine.Win]::ForegroundFullscreenMonitor($appPid)
      if ($fsm -ne 'self' -and $fsm -ne $script:lastFs) { $script:lastFs = $fsm; Send @{ type = 'fullscreen'; value = ($fsm -ne ''); monitor = $fsm } }
    } catch {}
  }
  $tick++
  Start-Sleep -Milliseconds 200
}
