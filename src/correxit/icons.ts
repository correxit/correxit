import { LabIcon } from '@jupyterlab/ui-components';
import CONVERT from '../../style/icons/convert.svg';
import CORRECT from '../../style/icons/correct.svg';
import KERNEL from '../../style/icons/kernel.svg';
import KEY from '../../style/icons/key.svg';
import LOCKED from '../../style/icons/locked.svg';
import SECRET from '../../style/icons/secret.svg';
import SHARED from '../../style/icons/shared.svg';
import UNLOCKED from '../../style/icons/unlocked.svg';

export namespace Icons {
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
  export const secret =
    new LabIcon({ name: 'correxit:secret', svgstr: SECRET });
  export const shared =
    new LabIcon({ name: 'correxit:shared', svgstr: SHARED });
  export const unlocked =
    new LabIcon({ name: 'correxit:unlocked', svgstr: UNLOCKED });
}
