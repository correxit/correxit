import { LabIcon } from '@jupyterlab/ui-components';
import ASSIGNEE from '../../style/icons/assignee.svg';
import ASSIGNMENT from '../../style/icons/assignment.svg';
import CONVERT from '../../style/icons/convert.svg';
import CORRECT from '../../style/icons/correct.svg';
import KERNEL from '../../style/icons/kernel.svg';
import KEY from '../../style/icons/key.svg';
import LOCKED from '../../style/icons/locked.svg';
import ROSTER from '../../style/icons/roster.svg';
import SECRET from '../../style/icons/secret.svg';
import SHARED from '../../style/icons/shared.svg';
import TEMPLATE from '../../style/icons/template.svg';
import UNLOCKED from '../../style/icons/unlocked.svg';
import ANSWER from '../../style/icons/answer.svg';
import COMPARE from '../../style/icons/compare.svg';
import CELLCORRECT from '../../style/icons/cellCorrect.svg';
import RESET from '../../style/icons/reset.svg';

export namespace Icons {
  export const assignee =
    new LabIcon({ name: 'correxit:assignee', svgstr: ASSIGNEE });
  export const assignment =
    new LabIcon({ name: 'correxit:assignment', svgstr: ASSIGNMENT });
  export const convert =
    new LabIcon({ name: 'correxit:convert', svgstr: CONVERT });
  export const correct =
    new LabIcon({ name: 'correxit:correct', svgstr: CORRECT });
  export const kernel =
    new LabIcon({ name: 'correxit:kernel', svgstr: KERNEL });
  export const key =
    new LabIcon({ name: 'correxit:key', svgstr: KEY });
  export const locked =
    new LabIcon({ name: 'correxit:locked', svgstr: LOCKED });
  export const roster =
    new LabIcon({ name: 'correxit:roster', svgstr: ROSTER });
  export const secret =
    new LabIcon({ name: 'correxit:secret', svgstr: SECRET });
  export const shared =
    new LabIcon({ name: 'correxit:shared', svgstr: SHARED });
  export const template =
    new LabIcon({ name: 'correxit:template', svgstr: TEMPLATE });
  export const unlocked =
    new LabIcon({ name: 'correxit:unlocked', svgstr: UNLOCKED });
  export const answer =
    new LabIcon({ name: 'correxit:answer', svgstr: ANSWER });
  export const compare =
    new LabIcon({ name: 'correxit:compare', svgstr: COMPARE });
  export const cellCorrect =
    new LabIcon({ name: 'correxit:cell-correct', svgstr: CELLCORRECT });
  export const reset =
    new LabIcon({ name: 'correxit:reset', svgstr: RESET });
}
