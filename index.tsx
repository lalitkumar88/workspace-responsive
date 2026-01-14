import classes from "@/assets/styles/pages/workspace.module.css";
import CronScheduler from "@/components/cron-scheduler";
import Checkbox from "@/components/form/checkbox";
import Input from "@/components/form/input";
import Select from "@/components/form/select";
import Modal from "@/components/utility/modal";
import { useAlertContext } from "@/context/alert-context";
import { useAuth } from "@/hooks/use-auth";
import { useTitle } from "@/hooks/use-title";
import ApiService from "@/shared/api-service";
import { getApiURL, parseCronExpression } from "@/shared/utils";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useFormik } from "formik";
import { Fragment, useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import * as Yup from "yup";
import CreateWorkspacePreview from "./create-workspace-preview";
import CreateWorkspaceProgress from "./create-workspace-progress";

interface Computes {
  cpu: string[];
  memory: string[];
  drive: string[];
}

type Step = "template" | "image" | "compute" | "scheduler";

export interface WorkspaceBody {
  id: string;
  name: string;
  project_id: string;
  template_id: string;
  template_name: string;
  workspace_type: "ide" | "cnv";
  build_type: "default" | "custom";
  schedule: boolean;
  start_cron_expression?: string;
  stop_cron_expression?: string;
  tshirt_size?: string;
  tfconfig: {
    image: string;
    image_name: string;
    cpu: string | number;
    memory: string | number;
    drive: string;
    OS: string;
    vm: string;
  };
  step: Step;
  created_by: string;
}

const IDEComputes = {
  cpu: ["1", "2", "3", "4"],
  memory: ["2", "4", "6", "8"],
  drive: ["10", "20", "30", "40"]
};

const CNVComputes = {
  cpu: ["2", "4", "8", "16"],
  memory: ["4", "8", "16", "32"],
  drive: ["60", "80", "100", "120"]
};

const formProgressHeading: Record<Step, string> = {
  template: "Select starter template for your workspace.",
  image: "Select build image for your workspace.",
  compute: "Select computes for your workspace.",
  scheduler: "Select schedules for your workspace"
};

function CreateWorkspace() {
  useTitle("Create Workspace");
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { setAlert } = useAlertContext();
  const [open, setOpen] = useState(false);
  const { user, projectName } = useAuth();
  const [templates, setTemplates] = useState<Template[]>([]);
  const [tshirtSizes, setshirtSizes] = useState<TshirtSize[]>([]);
  const [images, setImages] = useState<Build[]>([]);
  const [computes, setComputes] = useState<Computes>(IDEComputes);
  const [templateChanged, setTemplateChanged] = useState(false);

  const initialValues: WorkspaceBody = {
    id: "",
    name: "",
    project_id: projectName,
    template_id: "",
    template_name: "",
    workspace_type: "ide",
    build_type: "default",
    schedule: false,
    tshirt_size: "",
    tfconfig: {
      image: "",
      image_name: "",
      cpu: "",
      memory: "",
      drive: "",
      OS: "linux",
      vm: "vscode"
    },
    created_by: user?.email,
    step: "template"
  };

  const validationSchema = Yup.object({
    name: Yup.string()
      .required("Name is required")
      .matches(
        /^[a-zA-Z](([a-zA-Z0-9]+[ -]{0,1})*[a-zA-Z0-9])?$/,
        "Name cannot contain special characters other than space and dash."
      )
      .max(26, "Name exceeding max length of 26 characters."),
    template_id: Yup.string().required("Template ID is required"),
    project_id: Yup.string().required("Project Name is required"),
    created_by: Yup.string().required("Created By is required"),
    tshirt_size: Yup.string().required("Tshirt Size is required"),
    tfconfig: Yup.object()
      .required()
      .shape({
        image: Yup.string().required("Image name is required"),
        cpu: Yup.number().required("CPU count is required").min(1, "CPU must be atleast 1"),
        memory: Yup.number().required("Memory size is required").min(1, "Memory must be atleast 1"),
        drive: Yup.number().required("Storage size is required")
      })
  });

  const formik = useFormik<WorkspaceBody>({
    initialValues,
    validationSchema,
    validateOnMount: true,
    onSubmit: values => mutate(values)
  });

 const fetchTemplates = useCallback(async () => {
    try {
      const res = await ApiService.getData<Template[]>(`templates?project_id=${projectName}`);
      setTemplates(res.body);
    } catch (err: any) {
      setAlert(err?.error);
    }
  }, [projectName, setAlert]);

  const fetchTshirtSize = useCallback(async () => {
    try {
      const res = await ApiService.getData<[TshirtSize]>(`billing/tshirtsize`);
      setshirtSizes(res.body);
    } catch (err: any) {
      setAlert(err?.error);
    }
  }, [setAlert]);

  async function fetchImages(): Promise<void> {
    try {
      formik.setFieldValue("tfconfig.image", "");
      const queryParams: QueryParams = {
        project_id: projectName
      };
      const url = getApiURL(
        "builds",
        { ...queryParams, build_type: formik.values.build_type },
        formik.values.workspace_type
      );
      const res = await ApiService.getData<Build[]>(url);
      if (formik.values.workspace_type === "cnv") {
        if (formik.values.tfconfig?.OS?.toLowerCase() === "linux") {
          setImages(res.body.filter(item => item.type?.toLowerCase().includes("linux_cnv")));
        } else if (formik.values.tfconfig?.OS?.toLowerCase() === "windows") {
          setImages(res.body.filter(item => item.type?.toLowerCase().includes("windows_cnv")));
        } else {
          setImages(res.body);
        }
      } else {
        setImages(res.body);
      }
    } catch (err: any) {
      setAlert((err as ApiError).message);
      setImages([]);
    }
  }

  function generateWorkspaceID(name: string) {
    return name.toLowerCase().replace(/\s+/g, "-");
  }

const handleTshirtSize = useCallback(
    async (e: React.ChangeEvent<HTMLSelectElement>) => {
      const selectedSizeCode = e.target.value;
      await formik.setFieldValue("tshirt_size", selectedSizeCode);
      const selectedSize = tshirtSizes?.find((item) => item.size_code === selectedSizeCode);

      if (selectedSizeCode === "TX") {
        await formik.setFieldValue("tfconfig.cpu", "");
        await formik.setFieldValue("tfconfig.memory", "");
      } else if (selectedSize) {
        await formik.setFieldValue("tfconfig.cpu", selectedSize.cpu);
        await formik.setFieldValue("tfconfig.memory", selectedSize.memory);
      }

      /** ✅ Force revalidation so Submit button updates immediately */
      await formik.validateForm();
    },
    [formik, tshirtSizes]
  );

   const scheduleSleepShutdown = useCallback(
    (start: string, stop: string) => {
      formik.setFieldValue("start_cron_expression", start);
      formik.setFieldValue("stop_cron_expression", stop);
      setOpen(false);
    },
    [formik]
  );

  function getPrevStep(): Step {
    const steps = { scheduler: "compute", compute: "image", image: "template" };
    return steps[formik.values.step];
  }

  function getNextStep(): Step {
    const steps = { template: "image", image: "compute", compute: "scheduler" };
    return steps[formik.values.step];
  }

  function getPointerEvent(): "all" | "none" {
    const events = {
      template: formik.values.name && formik.values.template_id ? "all" : "none",
      image: formik.values.name && formik.values.template_id && formik.values.tfconfig?.image ? "all" : "none",
      compute:
        formik.values.name &&
        formik.values.template_id &&
        formik.values.tfconfig?.image &&
        formik.values.tfconfig?.cpu &&
        formik.values.tfconfig?.memory &&
        formik.values.tfconfig?.drive
          ? "all"
          : "none"
    };
    return events[formik.values.step];
  }

    function isStepValid(step: Step): boolean {
  const { values } = formik;

  switch (step) {
    case "template":
      return !!values.name && !!values.template_id;
    case "image":
      return !!values.tfconfig?.image;
    case "compute":
      return !!values.tshirt_size && !!values.tfconfig?.drive;
    default:
      return true;
  }
}

  const { mutate, isLoading } = useMutation({
    mutationFn: createWorkspace,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["workspaces"] });
    }
  });

  async function createWorkspace(values: Partial<WorkspaceBody>): Promise<void> {
    try {
      const isCustom = values.tshirt_size === "TX";
      const tfconfig = {
        ...values.tfconfig,
        drive: parseInt(values.tfconfig?.drive || "0")
      };

      if (isCustom) {
        tfconfig.cpu = parseInt(values.tfconfig?.cpu?.toString() || "0");
        tfconfig.memory = parseInt(values.tfconfig?.memory?.toString() || "0");
      } else {
        delete tfconfig.cpu;
        delete tfconfig.memory;
      }

      const body = { ...values, tfconfig };

      delete body.build_type;
      delete body.step;
      delete body.workspace_type;
      delete body.template_name;
      delete body.tfconfig.image_name;
      if (!body.schedule) {
        delete body.start_cron_expression;
        delete body.stop_cron_expression;
      }
      delete body.schedule;
      const res = await ApiService.postData<typeof body, Workspace>("workspaces", body);
      navigate(`/projects/${projectName}/workspaces`, { state: { workspace: res.body } });
      setAlert(res.message, { type: "success" });
    } catch (err: any) {
      setAlert((err as ApiError)?.error);
    }
  }

  useEffect(() => {
    fetchTemplates();
    fetchTshirtSize();
  }, []);
  useEffect(() => {
    if (formik.values.name) formik.setFieldValue("id", generateWorkspaceID(formik.values.name));
  }, [formik.values.name]);

  useEffect(() => {
    if (formik.values.template_id) {
      const template = templates.find(t => t.id === formik.values.template_id);
      if (template) {
        const os = template.type.toLowerCase().includes("windows") ? "Windows" : "Linux";
        formik.setFieldValue("tfconfig.OS", os);
        formik.setFieldValue("template_name", template.name);

        const templateType: "ide" | "cnv" = template.type.toLowerCase().includes("cnv") ? "cnv" : "ide";
        if (templateType !== formik.values.workspace_type) {
          formik.setFieldValue("workspace_type", templateType);
          setComputes(templateType === "cnv" ? CNVComputes : IDEComputes);
        }
        setTemplateChanged(true);
      }
    }
  }, [formik.values.template_id]);

  useEffect(() => {
    if (formik.values.template_id) {
      fetchImages();
    }
  }, [formik.values.workspace_type, formik.values.build_type]);
  useEffect(() => {
    if (templateChanged) {
      fetchImages();
      setTemplateChanged(false);
    }
  }, [formik.values.workspace_type, formik.values.tfconfig.OS, formik.values.build_type, templateChanged]);

  useEffect(() => {
    if (formik.values.tfconfig.image) {
      formik.setFieldValue(
        "tfconfig.image_name",
        images.find(
          img =>
            img["image_url"] === formik.values.tfconfig.image ||
            img.ImageURL === formik.values.tfconfig.image ||
            img.name === formik.values.tfconfig.image
        )?.name
      );
    }
  }, [formik.values.tfconfig.image]);

  useEffect(() => {
    if (formik.values.schedule) {
      formik.setFieldValue("start_cron_expression", "30 6 * * 1-5");
      formik.setFieldValue("stop_cron_expression", "30 14 * * 1-5");
    }
  }, [formik.values.schedule]);

  return (
    <Fragment>
      <article className="row">
        <section className="col-12 col-lg-8 d-flex">
          <CreateWorkspaceProgress
            currentStep={formik.values.step}
            changeStep={formik.setFieldValue}
            isScheduled={formik.values.schedule}
          />

          <section className={classes["ws-form"]}>
            <form onSubmit={formik.handleSubmit}>
              <h3 className={`text-black-50 h3 ${formik.values.step === "scheduler" ? "mb-5" : "mb-3"}`}>
                <i className="bi bi-info-circle me-3"></i>
                {formProgressHeading[formik.values.step]}
              </h3>

              {formik.values.step === "template" && (
                <Fragment>
                  <div className="d-flex align-items-center gap-3">
                    <label htmlFor="name" style={{ minWidth: "30%" }}>
                      Workspace Name<span className="text-primary">*</span>
                    </label>
                    <Input
                      name="name"
                      className="form-control"
                      placeholder="Enter Workspace Name"
                      onChange={formik.handleChange}
                      onBlur={formik.handleBlur}
                      value={formik.values.name}
                      error={formik.touched.name && formik.errors.name && formik.errors.name}
                    />
                  </div>

                  <div className="d-flex align-items-center gap-3">
                    <label htmlFor="template_id" style={{ minWidth: "30%" }}>
                      Select Template<span className="text-primary">*</span>
                    </label>
                    <Select
                     id="template_id"                    
                      name="template_id"
                      className="form-control fs-p"
                      onChange={formik.handleChange}
                      onBlur={formik.handleBlur}
                      value={formik.values.template_id}
                      error={formik.touched.template_id && formik.errors.template_id && formik.errors.template_id}
                    >
                      <option value="" hidden selected>
                        Select Starter Template
                      </option>
                      {templates?.map(template => (
                        <option key={template.created_at} value={template.id}>
                          {template.name || template.id}
                        </option>
                      ))}
                    </Select>
                  </div>
                </Fragment>
              )}

              {(formik.values.step === "template" || formik.values.step === "image") && (
                <div className="d-flex align-items-center gap-3 my-5">
                  <label htmlFor="workspace_type" style={{ minWidth: "30%" }}>
                    Workspace Type<span className="text-primary">*</span>
                  </label>
                  <Checkbox
                    disabled
                    name="workspace_type"
                    leftLabel="IDE"
                    rightLabel="CNV"
                    checked={formik.values.workspace_type === "cnv" ? true : false}
                    onChange={e => formik.setFieldValue("workspace_type", e.target.checked ? "cnv" : "ide")}
                  />
                </div>
              )}

              {formik.values.step === "image" && (
                <Fragment>
                  <div className="d-flex align-items-center gap-3 mb-3">
                    <label htmlFor="build_type" style={{ minWidth: "30%" }}>
                      Build Type<span className="text-primary">*</span>
                    </label>
                    <Checkbox
                      name="build_type"
                      leftLabel="Pre Build"
                      rightLabel="Custom Build"
                      checked={formik.values.build_type === "custom" ? true : false}
                      onChange={e => formik.setFieldValue("build_type", e.target.checked ? "custom" : "default")}
                    />
                  </div>

                  <div className="d-flex align-items-center gap-3 mb-5">
                    <label htmlFor="tfconfig.image" style={{ minWidth: "30%" }}>
                      Select Image<span className="text-primary">*</span>
                    </label>
                    <Select
                    id="tfconfig.image"
                      name="tfconfig.image"
                      className="form-control fs-p"
                      value={formik.values.tfconfig.image}
                      onChange={formik.handleChange}
                      onBlur={formik.handleBlur}
                      error={
                        formik.touched.tfconfig?.image && formik.errors.tfconfig?.image && formik.errors.tfconfig?.image
                      }
                    >
                      <option value="" hidden selected>
                        Select Build Image
                      </option>
                      {images?.map(image => (
                        <option
                          key={image.name}
                          value={image["image_url"] || image.ImageURL || image.name}
                          data-image={JSON.stringify(image)}
                        >
                          {image.name}
                        </option>
                      ))}
                    </Select>
                  </div>
                </Fragment>
              )}

              {formik.values.step === "compute" && (
                <Fragment>
                  <div className="d-flex align-items-center gap-3">
                    <label htmlFor="tshirt_size" style={{ minWidth: "30%" }}>
                      Tshirt Size<span className="text-primary">*</span>
                    </label>
                    <Select
                      id="tshirt_size"
                      name="tshirt_size"
                      className="form-control fs-p"
                      onChange={handleTshirtSize}
                      onBlur={formik.handleBlur}
                      value={formik.values?.tshirt_size}
                      error={formik.touched.tshirt_size && formik.errors.tshirt_size && formik.errors.tshirt_size}
                    >
                      <option value="" selected hidden>
                        Select Tshirt Size
                      </option>
                      {tshirtSizes?.map(image => (
                        <option
                          key={image?.size_code}
                          value={image["image_url"] || image?.size_code || image?.size_code}
                          data-image={JSON.stringify(image)}
                        >
                          {image?.size_code}
                        </option>
                      ))}
                    </Select>
                  </div>

                  <div className="d-flex align-items-center gap-3">
                    <label htmlFor="tfconfig.cpu" style={{ minWidth: "30%" }}>
                      CPU<span className="text-primary">*</span>
                    </label>
                    <Input
                      name="tfconfig.cpu"
                      className="form-control fs-p"
                      placeholder="Enter CPU Value"
                      onChange={formik.handleChange}
                      onBlur={formik.handleBlur}
                      value={formik.values?.tfconfig.cpu}
                      readOnly={formik.values?.tshirt_size !== "TX"}
                      error={formik.touched.tfconfig?.cpu && formik.errors.tfconfig?.cpu && formik.errors.tfconfig?.cpu}
                    ></Input>
                  </div>
                  <div className="d-flex align-items-center gap-3">
                    <label htmlFor="tfconfig.memory" style={{ minWidth: "30%" }}>
                      Memory<span className="text-primary">*</span>
                    </label>
                    <Input
                      name="tfconfig.memory"
                      className="form-control fs-p"
                      onChange={formik.handleChange}
                      placeholder="Enter Memory Value"
                      onBlur={formik.handleBlur}
                      value={formik.values?.tfconfig?.memory}
                      readOnly={formik.values?.tshirt_size !== "TX"}
                      error={
                        formik.touched.tfconfig?.memory &&
                        formik.errors.tfconfig?.memory &&
                        formik.errors.tfconfig?.memory
                      }
                    ></Input>
                  </div>

                  <div className="d-flex align-items-center gap-3 mb-3">
                    <label htmlFor="tfconfig.drive" style={{ minWidth: "30%" }}>
                      Storage<span className="text-primary">*</span>
                    </label>
                    <Select
                      id="tfconfig.drive"
                      name="tfconfig.drive"
                      className="form-control fs-p"
                      onChange={formik.handleChange}
                      onBlur={formik.handleBlur}
                      value={formik.values.tfconfig?.drive}
                      error={
                        formik.touched.tfconfig?.drive && formik.errors.tfconfig?.drive && formik.errors.tfconfig?.drive
                      }
                    >
                      <option value="" selected hidden>
                        Select Storage
                      </option>
                      {computes.drive.map(drive => (
                        <option key={drive} value={drive}>
                          {drive} GB
                        </option>
                      ))}
                    </Select>
                  </div>
                </Fragment>
              )}

              {(formik.values.step === "compute" || formik.values.step === "scheduler") && (
                <div className="d-flex align-items-center gap-3 mb-3">
                  <label htmlFor="schedule" style={{ minWidth: "30%" }}>
                    Schedule
                  </label>
                  <Checkbox
                    name="schedule"
                    leftLabel="Disabled"
                    rightLabel="Enabled"
                    checked={formik.values.schedule}
                    onChange={formik.handleChange}
                  />
                </div>
              )}

              {formik.values.schedule && formik.values.step === "scheduler" && (
                <Fragment>
                  <div className="d-flex align-items-center gap-3">
                    <label htmlFor="start_cron_expression" style={{ minWidth: "30%" }}>
                      Start Schedule<span className="text-primary">*</span>
                    </label>
                    <span className="p-3">{parseCronExpression(formik.values?.start_cron_expression)}</span>
                  </div>

                  <div className="d-flex align-items-center gap-3 mb-5">
                    <label htmlFor="stop_cron_expression" style={{ minWidth: "30%" }}>
                      Stop Schedule<span className="text-primary">*</span>
                    </label>
                    <span className="p-3">{parseCronExpression(formik.values?.stop_cron_expression)}</span>
                  </div>
                </Fragment>
              )}

              <div className="mt-5">
                {formik.values.step !== "template" && (
                  <button
                    type="button"
                    className="btn btn-dark float-start"
                    onClick={() => formik.setFieldValue("step", getPrevStep())}
                  >
                    Previous
                  </button>
                )}

                {((formik.values.step === "compute" && !formik.values.schedule) ||
                  formik.values.step === "scheduler") && (
                  <button
                    type="submit"
                    className="btn btn-primary float-end ms-3"
                    style={{ minWidth: "25%" }}
                    disabled={!formik.isValid}
                  >
                    {isLoading ? (
                      <div className="spinner-border text-light align-middle" role="status"></div>
                    ) : (
                      "Submit"
                    )}
                  </button>
                )}

                {!(
                  (formik.values.step === "compute" && !formik.values.schedule) ||
                  formik.values.step === "scheduler"
                ) && (
                  <button
                    type="button"
                    className="btn btn-primary float-end ms-3"
                    style={{ minWidth: "25%", pointerEvents: getPointerEvent() }}
                    disabled={!isStepValid(formik.values.step)}
                    onClick={() => formik.setFieldValue("step", getNextStep())}
                  >
                    Save & Next
                  </button>
                )}

                {formik.values.schedule && formik.values.step === "scheduler" && (
                  <button type="button" className="btn btn-info float-end" onClick={() => setOpen(true)}>
                    Select Schedule
                  </button>
                )}
              </div>
            </form>
            <Modal open={open} close={setOpen}>
              <CronScheduler
                close={setOpen}
                defaultValues={{
                  startCronString: formik.values.start_cron_expression || "30 6 * * 1-5",
                  stopCronString: formik.values.stop_cron_expression || "30 14 * * 1-5"
                }}
                scheduleHandler={scheduleSleepShutdown}
              />
            </Modal>
          </section>
        </section>

        <CreateWorkspacePreview formData={formik.values} />
      </article>
    </Fragment>
  );
}

export default CreateWorkspace;
