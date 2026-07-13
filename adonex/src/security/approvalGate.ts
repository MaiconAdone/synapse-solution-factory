import * as vscode from "vscode";

export async function requestApproval(
  title: string,
  detail: string,
  approveLabel = "Approve"
): Promise<boolean> {
  const selection = await vscode.window.showWarningMessage(
    title,
    { modal: true, detail },
    approveLabel
  );
  return selection === approveLabel;
}
