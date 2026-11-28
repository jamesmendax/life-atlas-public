!include "WordFunc.nsh"

; electron-builder expands customHeader after MUI_LANGUAGE defines the language IDs.
!macro customHeader
  !ifdef BUILD_UNINSTALLER
    LangString atlasKeepDataNotice ${LANG_SIMPCHINESE} "卸载只会删除 Life Atlas 程序。你的数据目录（全部页面、附件、密钥库和快照）不会被删除。以后重新安装时选择同一个数据目录，就能继续使用。"
    LangString atlasKeepDataNotice ${LANG_JAPANESE} "アンインストールで削除されるのは Life Atlas 本体のみです。データフォルダー（すべてのページ、添付ファイル、保管庫、スナップショット）は削除されません。再インストール時に同じデータフォルダーを選ぶと、引き続き使用できます。"
    LangString atlasKeepDataNotice ${LANG_ENGLISH} "Uninstalling removes only the Life Atlas app. Your data folder (including all pages, attachments, vault data, and snapshots) will be kept. To use it again, choose the same data folder when you reinstall."
  !else
    LangString atlasRuntimeReadWarning ${LANG_SIMPCHINESE} "无法设置程序文件的读取权限 ($R0)：$R4"
    LangString atlasRuntimeReadWarning ${LANG_JAPANESE} "プログラムファイルの読み取り権限を設定できませんでした ($R0)：$R4"
    LangString atlasRuntimeReadWarning ${LANG_ENGLISH} "Could not set read permissions for the program file ($R0): $R4"
    LangString atlasMarkdownPreviewName ${LANG_SIMPCHINESE} "Life Atlas Markdown 预览"
    LangString atlasMarkdownPreviewName ${LANG_JAPANESE} "Life Atlas Markdown プレビュー"
    LangString atlasMarkdownPreviewName ${LANG_ENGLISH} "Life Atlas Markdown Preview"
  !endif
!macroend

; Chromium reads its installed runtime from Windows AppContainer processes.
; Custom install locations do not always inherit these read permissions.
!macro atlasGrantRuntimeRead FilePath Access
  ${If} ${FileExists} "${FilePath}"
    nsExec::ExecToLog /TIMEOUT=15000 '"$SYSDIR\icacls.exe" "${FilePath}" /grant "*S-1-15-2-1:${Access}" "*S-1-15-2-2:${Access}" /L /Q'
    Pop $R0
    ${If} $R0 != 0
      StrCpy $R4 "${FilePath}"
      DetailPrint "$(atlasRuntimeReadWarning)"
    ${EndIf}
  ${EndIf}
!macroend

!macro atlasGrantRuntimeList Prefix Names Suffix Access
  ${WordFind} "${Names}" "|" "#" $R3
  ${For} $R2 1 $R3
    ${WordFind} "${Names}" "|" "+$R2" $R1
    !insertmacro atlasGrantRuntimeRead "$INSTDIR\${Prefix}$R1${Suffix}" "${Access}"
  ${Next}
!macroend


!define ATLAS_MARKDOWN_PROGID "LifeAtlas.MarkdownPreview"
!define ATLAS_MARKDOWN_APP "Software\Classes\Applications\${APP_EXECUTABLE_FILENAME}"
!define ATLAS_MARKDOWN_COMMAND '"$INSTDIR\${APP_EXECUTABLE_FILENAME}" --markdown-preview "%1"'

!macro atlasRegisterMarkdownExtension Extension
  WriteRegStr SHCTX "Software\Classes\${Extension}\OpenWithProgids" "${ATLAS_MARKDOWN_PROGID}" ""
  WriteRegStr SHCTX "${ATLAS_MARKDOWN_APP}\SupportedTypes" "${Extension}" ""
!macroend

!macro atlasUnregisterMarkdownExtension Extension
  DeleteRegValue SHCTX "Software\Classes\${Extension}\OpenWithProgids" "${ATLAS_MARKDOWN_PROGID}"
  DeleteRegValue SHCTX "${ATLAS_MARKDOWN_APP}\SupportedTypes" "${Extension}"
!macroend

!macro atlasMarkdownExtensions Action
  !insertmacro ${Action} ".md"
  !insertmacro ${Action} ".markdown"
  !insertmacro ${Action} ".mdown"
  !insertmacro ${Action} ".mkdn"
  !insertmacro ${Action} ".mkd"
  !insertmacro ${Action} ".rmd"
!macroend

!macro atlasRegisterMarkdownPreview
  WriteRegStr SHCTX "Software\Classes\${ATLAS_MARKDOWN_PROGID}" "" "$(atlasMarkdownPreviewName)"
  WriteRegStr SHCTX "Software\Classes\${ATLAS_MARKDOWN_PROGID}\shell\open" "MultiSelectModel" "Player"
  WriteRegStr SHCTX "Software\Classes\${ATLAS_MARKDOWN_PROGID}\shell\open\command" "" `${ATLAS_MARKDOWN_COMMAND}`
  WriteRegStr SHCTX "${ATLAS_MARKDOWN_APP}" "FriendlyAppName" "$(atlasMarkdownPreviewName)"
  WriteRegStr SHCTX "${ATLAS_MARKDOWN_APP}\shell\open" "MultiSelectModel" "Player"
  WriteRegStr SHCTX "${ATLAS_MARKDOWN_APP}\shell\open\command" "" `${ATLAS_MARKDOWN_COMMAND}`
  !insertmacro atlasMarkdownExtensions atlasRegisterMarkdownExtension
  System::Call 'shell32::SHChangeNotify(i,i,p,p) v (0x08000000, 0, 0, 0)'
!macroend

!macro customUnInstall
  Push $R0
  ReadRegStr $R0 SHCTX "Software\Classes\${ATLAS_MARKDOWN_PROGID}\shell\open\command" ""
  ${If} $R0 == `${ATLAS_MARKDOWN_COMMAND}`
    !insertmacro atlasMarkdownExtensions atlasUnregisterMarkdownExtension
    DeleteRegKey SHCTX "Software\Classes\${ATLAS_MARKDOWN_PROGID}"
  ${EndIf}
  ReadRegStr $R0 SHCTX "${ATLAS_MARKDOWN_APP}\shell\open\command" ""
  ${If} $R0 == `${ATLAS_MARKDOWN_COMMAND}`
    DeleteRegValue SHCTX "${ATLAS_MARKDOWN_APP}" "FriendlyAppName"
    DeleteRegValue SHCTX "${ATLAS_MARKDOWN_APP}\shell\open" "MultiSelectModel"
    DeleteRegValue SHCTX "${ATLAS_MARKDOWN_APP}\shell\open\command" ""
    DeleteRegKey /ifempty SHCTX "${ATLAS_MARKDOWN_APP}\shell\open\command"
    DeleteRegKey /ifempty SHCTX "${ATLAS_MARKDOWN_APP}\shell\open"
    DeleteRegKey /ifempty SHCTX "${ATLAS_MARKDOWN_APP}\shell"
    DeleteRegKey /ifempty SHCTX "${ATLAS_MARKDOWN_APP}\SupportedTypes"
    DeleteRegKey /ifempty SHCTX "${ATLAS_MARKDOWN_APP}"
  ${EndIf}
  Pop $R0
!macroend

!macro customInstall
  Push $R0
  Push $R1
  Push $R2
  Push $R3
  Push $R4
  ; Apply non-inheriting access to precisely the Electron runtime paths.
  ; A sibling workspace or an unrelated file in the install folder keeps its ACL.
  !insertmacro atlasGrantRuntimeRead "$INSTDIR" RX
  !insertmacro atlasGrantRuntimeRead "$INSTDIR\resources" RX
  !insertmacro atlasGrantRuntimeRead "$INSTDIR\locales" RX
  !insertmacro atlasGrantRuntimeRead "$INSTDIR\${APP_EXECUTABLE_FILENAME}" RX
  !insertmacro atlasGrantRuntimeRead "$INSTDIR\resources\app.asar" R
  !insertmacro atlasGrantRuntimeList "" "chrome_100_percent.pak|chrome_200_percent.pak|icudtl.dat|resources.pak|snapshot_blob.bin|v8_context_snapshot.bin|vk_swiftshader_icd.json" "" R
  !insertmacro atlasGrantRuntimeList "" "d3dcompiler_47|dxcompiler|dxil|ffmpeg|vk_swiftshader|vulkan-1" ".dll" RX
  !insertmacro atlasGrantRuntimeList "locales\" "af|am|ar|bg|bn|ca|cs|da|de|el|en-GB|en-US|es-419|es|et|fa|fi|fil|fr|gu|he|hi|hr|hu|id|it|ja|kn|ko|lt|lv|ml|mr|ms|nb|nl|pl|pt-BR|pt-PT|ro|ru|sk|sl|sr|sv|sw|ta|te|th|tr|uk|ur|vi|zh-CN|zh-TW" ".pak" R
  !insertmacro atlasRegisterMarkdownPreview
  Pop $R4
  Pop $R3
  Pop $R2
  Pop $R1
  Pop $R0
!macroend

!macro customUnInit
  MessageBox MB_OK|MB_ICONINFORMATION "$(atlasKeepDataNotice)" /SD IDOK
!macroend
