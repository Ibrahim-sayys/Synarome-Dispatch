# Windows scanner companion (development preview)

This companion runs on the Windows computer connected to the scanner. It requires Python 3 (including Tkinter and the Python launcher), an installed WIA-compatible scanner driver, and the files in this directory. It is a development preview, not an installer or a verified production release.

1. Copy this entire directory to the Windows computer. Install Python 3 and the scanner's Windows WIA driver, and check the scanner works in Windows Scan.
2. Double-click **Start Scanner.bat**. The first time, enter the exact HTTPS website address you use for Synarome Dispatch and select OK. The companion saves the website address in your Windows user profile and uses it on future starts. Leave the companion running while scanning. Only run one copy at a time.
3. Open that same website on the Windows computer. In the Dispatch composer, choose **Attach > Scan Document**. The app looks for scanners and selects the first one automatically; select another from the list if needed. Use **Refresh** to search again. Allow browser local network access if prompted.
4. Select a scanner, place a page on the flatbed, and choose **Scan page**. Repeat for further pages. Use **Preview & crop** to zoom or trim the edges of individual pages, or remove a page. Select PDF/JPEG/PNG, and add them to the draft. Review the draft and recipients before sending.
5. If started with the visible batch file, close its window when finished. Closing the scan dialog discards the draft scan; it does not necessarily stop a scan already running on the device.

For a background start, put a shortcut to **Start Scanner Silently.vbs** in `shell:startup` instead of the batch file. It starts the same companion without showing its console. Keep all companion files together. To stop a silently started companion, use Windows Task Manager to end its Python process; to troubleshoot startup, run **Start Scanner.bat** directly to see any errors.

To change the saved address, stop the running companion and double-click **Change Website Address.bat**. Enter the new address; the companion starts using it immediately. If your ngrok address changes, update it here as well. Remembering the address does not reserve the ngrok domain or keep the tunnel running.

Only the configured website origin (scheme, hostname, and port) is allowed; paths are ignored. The companion also accepts localhost HTTP and private IPv4 HTTP addresses, but browsers may block access from HTTP network pages. HTTPS or localhost is recommended. For command-line use, `py scanner_companion.py --origin https://your-app-domain.example` saves an address and starts the companion; `--configure` opens the address dialog.

The companion listens only on 127.0.0.1:17653 and checks the website origin and host header. There is no pairing code: any page on the configured origin can access the scanner while the companion is running, so only save a website you trust. Other local programs can also issue requests. Scans are processed locally, with temporary files removed after a scan; if Windows or the process crashes, temporary files may remain in the Windows temporary directory. The PDF or images remain in browser memory until attached and sent. The server stores and sends them only when the user presses Send.

The companion expects BMP transfer from WIA and converts each page to JPEG at approximately 200 dpi when supported. WIA settings and capabilities differ by device. Test scanning, page order, PDF preview, network-connected scanners, and browsers on the Windows computer before using it for real documents. The current implementation does not support a feeder, duplex, a native scan progress indicator, or cancelling an in-flight scanner operation.

Run the local bridge tests with `python -m unittest discover -s scanner-companion -p "test_*.py"` from the repository root. They simulate WIA operations; they do not test Windows or scanner hardware.
