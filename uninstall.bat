@echo off
:: Etiketas uninstaller. Removes the installed app and its Desktop shortcut.
:: Your labels, settings and the shared OneDrive folder are not touched.
:: Same as:  install.bat uninstall   (add -Yes to skip the confirmation question)
call "%~dp0install.bat" uninstall %*
