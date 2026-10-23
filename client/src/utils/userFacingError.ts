const SAFE_MESSAGES = new Map<string, string>([
  [
    'Invalid or expired room invitation.',
    'That room invite is invalid or has expired.',
  ],
  [
    'Invalid participant identity.',
    'Could not verify your room identity. Refresh the page and try again.',
  ],
  [
    'This room is no longer available.',
    'This room is no longer available. Check the invite link or create a new room.',
  ],
  [
    'Syncode is at its active room limit. Please try again later.',
    'The service is busy creating rooms. Try again shortly.',
  ],
  [
    'Syncode is at its connection limit. Please try again later.',
    'The service is temporarily at capacity. Try again shortly.',
  ],
  [
    'Display names must be 32 characters or fewer.',
    'Names can be up to 32 characters.',
  ],
  [
    'An item with that name already exists in this folder.',
    'An item with that name already exists here.',
  ],
  [
    'A room must keep at least one file.',
    'A room must keep at least one file.',
  ],
  [
    'File or folder no longer exists.',
    'That file or folder is no longer available. Refresh the explorer and try again.',
  ],
  [
    'File no longer exists.',
    'That file is no longer available. Refresh the explorer and try again.',
  ],
  [
    'Parent folder no longer exists.',
    'That folder is no longer available. Refresh the explorer and try again.',
  ],
  [
    'Invalid folder hierarchy.',
    'That folder location is no longer available. Refresh the explorer and try again.',
  ],
  [
    'A room can contain up to 500 files and folders.',
    'This room has reached its file and folder limit.',
  ],
  [
    'Folders can be nested up to 16 levels.',
    'Folders can be nested up to 16 levels.',
  ],
  [
    'Enter a valid file name (up to 128 characters).',
    'Enter a valid name with up to 128 characters.',
  ],
  [
    'Choose a valid avatar color.',
    'Choose one of the available avatar colors.',
  ],
  [
    'You cannot change your own edit access.',
    'You cannot change your own editing access.',
  ],
  [
    'Select a participant in this room.',
    'Select someone who is currently in this room.',
  ],
  [
    'Only a room admin can change edit access.',
    'Only a room admin can change editing access.',
  ],
  [
    'Only a room admin can manage admin access.',
    'Only a room admin can change admin roles.',
  ],
  [
    'Only a room admin can remove participants.',
    'Only a room admin can remove participants from the room.',
  ],
  [
    'You cannot remove yourself from the room.',
    'You cannot remove yourself from the room.',
  ],
  [
    'That participant is no longer in the room.',
    'That participant is no longer in the room.',
  ],
  [
    'Admins cannot be locked.',
    'Admin participants cannot be locked from editing.',
  ],
  [
    'The room admin has locked your editing access.',
    'An admin has paused your editing access. Ask an admin to restore it.',
  ],
  [
    'Chat rate limit reached. Please wait before sending more messages.',
    'Messages are being sent too quickly. Wait a moment and try again.',
  ],
  [
    'File creation rate limit reached. Please wait before creating more files or folders.',
    'Files and folders are being created too quickly. Wait a moment and try again.',
  ],
  [
    'Terminal input rate limit reached. Wait a moment and try again.',
    'Terminal input is being sent too quickly. Wait a moment and try again.',
  ],
  [
    'Terminal output is being requested too quickly.',
    'Terminal output is being requested too quickly. Wait a moment and try again.',
  ],
  [
    'Execution rate limit reached. Please wait before submitting another run.',
    'Code is being run too quickly. Wait a moment and try again.',
  ],
  [
    'The execution queue is full. Try again shortly.',
    'The code runner is busy. Wait a moment and try again.',
  ],
  [
    'Terminal session has ended.',
    'This terminal session has ended. Open a new terminal to continue.',
  ],
  [
    'Terminal session not found.',
    'This terminal session is no longer available. Open a new terminal to continue.',
  ],
  [
    'You can have up to three terminal tabs open at once.',
    'You can have up to three terminal tabs open at once.',
  ],
  [
    'Join a room before opening a terminal.',
    'Join a room before opening a terminal.',
  ],
  [
    'Join a room before using a terminal.',
    'Join a room before using a terminal.',
  ],
  ['Join a room before running code.', 'Join a room before running code.'],
  [
    'Invalid terminal output offset.',
    'Could not load terminal output. Open a new terminal and try again.',
  ],
  [
    'Invalid execution id.',
    'That code run is no longer available. Run it again to continue.',
  ],
  [
    'Execution not found.',
    'This code run is no longer available. Run it again to continue.',
  ],
  [
    'The terminal service is unavailable.',
    'The terminal service is unavailable. Try again shortly.',
  ],
  [
    'The code execution service is unavailable.',
    'The code runner is unavailable. Try again shortly.',
  ],
  [
    'The terminal service did not respond in time.',
    'The terminal service took too long to respond. Try again.',
  ],
  [
    'The code execution service did not respond in time.',
    'The code runner took too long to respond. Try again.',
  ],
  [
    'The isolated Bash terminal could not start. Check that Docker is available and the syncode-runner-bash image is built.',
    'Could not start a Bash terminal. Try again or contact the room host.',
  ],
  [
    'Could not queue code for execution. Please try again.',
    'Could not start the code run. Try again shortly.',
  ],
  [
    'The terminal service returned an invalid response.',
    'The terminal service returned an unexpected response. Try again.',
  ],
  [
    'The execution service returned an invalid response.',
    'The code runner returned an unexpected response. Try again.',
  ],
  [
    'Code execution is not configured on this server.',
    'Code execution is not available right now.',
  ],
  [
    'Could not attach an interactive terminal to this run.',
    'Could not attach a terminal to this code run. Try again.',
  ],
  [
    'Invalid execution request.',
    'Could not start the code run. Check the selected file and try again.',
  ],
  [
    'Source must be 64 KB or less.',
    'This file is too large to run. Reduce it to 64 KB or less.',
  ],
  [
    'This file type cannot be run in the terminal.',
    'This file type cannot be run in a terminal.',
  ],
  [
    'Invalid terminal input.',
    'Could not send that terminal input. Check it and try again.',
  ],
  [
    'This execution is no longer accepting input.',
    'This code run has finished and no longer accepts input.',
  ],
]);

export function userFacingError(error: unknown, fallback: string): string {
  if (error instanceof SyntaxError) {
    return 'The selected file is not valid JSON.';
  }

  const message = error instanceof Error ? error.message : '';
  const safeMessage = SAFE_MESSAGES.get(message);
  if (safeMessage) return safeMessage;

  if (
    /^This room is full\. Rooms can have up to \d+ participants\.$/.test(
      message
    )
  ) {
    return 'This room is full. Ask the host to make space before joining.';
  }
  if (
    /^Execution rate limit reached\. Try again in \d+ seconds\.$/.test(message)
  ) {
    const seconds = Number(message.match(/\d+/)?.[0]);
    return `Code is being run too quickly. Try again in ${seconds} seconds.`;
  }

  return fallback;
}
